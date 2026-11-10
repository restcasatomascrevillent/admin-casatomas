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

// ============================================================================
// CONSENTIMIENTOS DEL FORMULARIO WEB (RGPD) — 2026-10-03
// ============================================================================
// El formulario de casa-tomas-story manda dos booleanos con estos nombres
// EXACTOS en el cuerpo de POST /crear:
//   · `acepta_condiciones`        — casilla OBLIGATORIA (política de
//     privacidad y condiciones de la reserva). Sin ella no se crea nada.
//   · `consentimiento_newsletter` — casilla OPCIONAL (desmarcada por defecto)
//     para recibir el newsletter. Se guarda en
//     `reservas.consentimiento_newsletter` (o en
//     `solicitudes_pendientes.consentimiento_newsletter` si la reserva no se
//     puede crear y queda como solicitud). DOBLE OPT-IN (migración
//     20261003184500): el alta NO es inmediata; el trigger
//     `newsletter_alta_reserva_verificada_upd` da de alta (o reactiva) el
//     email cuando el cliente pulsa «Confirmo» en el correo de la propuesta
//     (`reservas.email_verificado_at`, ver _shared/verificacion-email.ts).
//
// SOLO `=== true` cuenta como sí. "true", 1, "on", null o la ausencia del
// campo son NO: el consentimiento tiene que ser una acción afirmativa e
// inequívoca (RGPD art. 4.11 y 7) — nunca se infiere de un valor ambiguo.
//
// Hasta este cambio reservas-web no leía `consentimiento_newsletter` (aunque
// el COMMENT de la columna decía que sí): todas las reservas web guardaban
// false y el trigger no daba de alta a nadie.
// ============================================================================

export interface ConsentimientosReserva {
  aceptaCondiciones: boolean;
  consentimientoNewsletter: boolean;
}

/** Lee las dos casillas del cuerpo. Cualquier cosa distinta de `true` es false. */
export function leerConsentimientos(body: Record<string, unknown> | null | undefined): ConsentimientosReserva {
  return {
    aceptaCondiciones: body?.acepta_condiciones === true,
    consentimientoNewsletter: body?.consentimiento_newsletter === true,
  };
}

/**
 * ¿Se exige `acepta_condiciones`? Interruptor de emergencia por secret
 * (`RESERVAS_WEB_CONDICIONES_OBLIGATORIAS`): por defecto SÍ. Solo el valor
 * literal "false" (sin distinguir mayúsculas ni espacios) lo desactiva, para
 * que un secret mal escrito nunca apague la exigencia por accidente.
 * Pensado para la transición: si la función se despliega antes que la web
 * que manda la casilla, `supabase secrets set
 * RESERVAS_WEB_CONDICIONES_OBLIGATORIAS=false` deja pasar las reservas sin
 * redesplegar; `supabase secrets unset ...` vuelve a exigirla.
 */
export function condicionesObligatorias(valorSecret: string | null | undefined): boolean {
  return (valorSecret ?? "").trim().toLowerCase() !== "false";
}

export const ERROR_CONDICIONES_NO_ACEPTADAS = "condiciones_no_aceptadas";

export interface RechazoCondiciones {
  status: 400;
  cuerpo: { ok: false; error: typeof ERROR_CONDICIONES_NO_ACEPTADAS; mensaje: string };
}

/**
 * 400 si se exige la casilla y no viene marcada; `null` si se puede seguir.
 * 400 (no 422): es un dato obligatorio del formulario que falta, igual que
 * `nombre_requerido`; se rechaza ANTES de cualquier lectura o escritura (no
 * se registra solicitud ni se manda correo de alguien que no ha aceptado).
 */
export function rechazoCondicionesNoAceptadas(
  consentimientos: ConsentimientosReserva,
  exigir: boolean,
): RechazoCondiciones | null {
  if (!exigir || consentimientos.aceptaCondiciones) return null;
  return {
    status: 400,
    cuerpo: {
      ok: false,
      error: ERROR_CONDICIONES_NO_ACEPTADAS,
      mensaje: "Para enviar la reserva tienes que aceptar la política de privacidad y las condiciones de la reserva.",
    },
  };
}

/**
 * ¿El error de PostgREST es «esa columna no existe»? (PGRST204, «Could not
 * find the 'x' column of 'reservas' in the schema cache»). Lo usa el INSERT
 * de `handleCrear` para no tumbar las reservas si la función se despliega
 * antes que la migración que crea `condiciones_aceptadas_at`.
 */
export function esColumnaInexistente(
  error: { code?: string | null; message?: string | null } | null | undefined,
  columna: string,
): boolean {
  if (!error) return false;
  const mensaje = error.message ?? "";
  if (!mensaje.includes(`'${columna}'`)) return false;
  return error.code === "PGRST204" || /could not find .* column/i.test(mensaje);
}

// ============================================================================
// CONSENTIMIENTOS EN solicitudes_pendientes (migración 20261003184500)
// ============================================================================
// Cuando /crear no puede crear la reserva (grupo grande, sin aforo, para hoy,
// corte horario, límites...) la deja en `solicitudes_pendientes`. Antes la
// casilla del newsletter se perdía ahí; ahora se guarda con la solicitud y la
// BD la copia a la reserva que salga de ella (mismo email). El alta sigue
// esperando a que el cliente verifique el email desde el correo.
// ============================================================================

/** Columnas de la solicitud que solo existen con la migración 20261003184500. */
export const COLUMNAS_CONSENTIMIENTO_SOLICITUD = ["consentimiento_newsletter", "condiciones_aceptadas_at"] as const;

/** Lo que se guarda en la solicitud. Mismo criterio que en la reserva. */
export function camposConsentimientoSolicitud(
  consentimientos: ConsentimientosReserva | null | undefined,
  ahoraIso: string,
): { consentimiento_newsletter: boolean; condiciones_aceptadas_at: string | null } {
  return {
    consentimiento_newsletter: consentimientos?.consentimientoNewsletter === true,
    condiciones_aceptadas_at: consentimientos?.aceptaCondiciones === true ? ahoraIso : null,
  };
}

/** ¿El error de PostgREST es por una de esas columnas (migración sin aplicar)? */
export function faltaColumnaConsentimientoSolicitud(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  return COLUMNAS_CONSENTIMIENTO_SOLICITUD.some((c) => esColumnaInexistente(error, c));
}

// ============================================================================
// SALVAGUARDA DEL DOBLE OPT-IN (revisión final, 2026-10-04)
// ============================================================================
// Mientras la migración 20261003184500 NO esté aplicada sigue vivo el trigger
// `agregar_suscriptor_al_reservar_consentida` (20260926062009, redefinido en
// 20261003143000, ya en producción): da de alta en el newsletter EN EL MISMO
// INSERT de una reserva con `consentimiento_newsletter = true`, sin verificar
// el email — cualquiera podría suscribir un email ajeno desde la web.
//
// Por eso esta función solo guarda la casilla en la BD cuando ha comprobado
// que el doble opt-in está activo. La señal es la columna
// `reservas.email_verificado_at`: la crea 20261003184500 en la MISMA
// transacción (begin/commit propios) que borra el trigger antiguo, así que
// "existe la columna" equivale a "ya no hay alta sin verificar". Si la
// comprobación no es concluyente (error de red, etc.) tampoco se guarda: se
// pierde una casilla (lado seguro) antes que suscribir a alguien sin verificar.
// (Tras un ROLLBACK de 20261003184500 la columna queda y vuelve el trigger
// antiguo: es la vuelta atrás documentada en ese rollback.)
// ============================================================================

export type EstadoDobleOptin = "activo" | "inactivo" | "desconocido";

/** Interpreta el sondeo `select email_verificado_at ... limit 0` sobre reservas. */
export function interpretarSondeoDobleOptin(
  error: { code?: string | null; message?: string | null } | null | undefined,
): EstadoDobleOptin {
  if (!error) return "activo";
  const mensaje = error.message ?? "";
  if (error.code === "42703" || (mensaje.includes("email_verificado_at") && /does not exist|could not find/i.test(mensaje))) {
    return "inactivo";
  }
  return "desconocido";
}

/** Valor de `consentimiento_newsletter` que se escribe en la reserva: solo `true` con el doble opt-in confirmado. */
export function consentimientoNewsletterParaGuardar(
  consentimientos: ConsentimientosReserva,
  dobleOptin: EstadoDobleOptin,
): boolean {
  return consentimientos.consentimientoNewsletter === true && dobleOptin === "activo";
}

// ============================================================================
// BLOQUEOS DE LA WEB: servicio bloqueado, mismo día solo por teléfono y menú
// del día (migración 20261122100000, 10/11/2026)
// ============================================================================
// Solo afectan a la web/bot (esta función). Las reservas manuales del panel
// NO pasan por aquí: el trigger de aforo no sabe nada de esto a propósito.
// Turno: comida = hora < 17:00, como `validar_capacidad_reserva`.
// ============================================================================

/** Mismo día: franja (ambas incluidas, "HH:MM") que solo se reserva por teléfono. */
export const MISMO_DIA_TELEFONO_DESDE = "12:30";
export const MISMO_DIA_TELEFONO_HASTA = "16:00";
/** Días del menú del día (0 = domingo … 6 = sábado): martes, miércoles y jueves. */
export const DIAS_MENU_DEL_DIA: ReadonlyArray<number> = [2, 3, 4];
/** Salas en las que se sirve el menú del día (nombre sin tildes ni mayúsculas). */
export const SALAS_MENU_DEL_DIA: ReadonlyArray<string> = ["comedor", "terraza"];

export const CODIGO_SERVICIO_BLOQUEADO = "SERVICIO_BLOQUEADO";
export const CODIGO_MISMO_DIA_TELEFONO = "MISMO_DIA_TELEFONO";
export const CODIGO_MENU_DIA_NO_DISPONIBLE = "MENU_DIA_NO_DISPONIBLE";

export type TurnoWeb = "comida" | "cena";

export interface RechazoBloqueoWeb {
  status: 422;
  cuerpo: { ok: false; motivo: string; error: string; mensaje: string };
}

function rechazo(codigo: string, mensaje: string): RechazoBloqueoWeb {
  return { status: 422, cuerpo: { ok: false, motivo: codigo, error: codigo, mensaje } };
}

/** "HH:MM" (o "HH:MM:SS") recortada a "HH:MM". */
function hhmm(hora: string): string {
  return String(hora || "").slice(0, 5);
}

/** Turno con el criterio del trigger de aforo: comida si hora < 17:00. */
export function turnoDeHoraWeb(hora: string): TurnoWeb {
  return hhmm(hora) < "17:00" ? "comida" : "cena";
}

/** Lista de turnos válidos desde las filas de `servicios_bloqueados` de UN día. */
export function turnosBloqueadosDesdeFilas(filas: ReadonlyArray<{ turno?: unknown }> | null | undefined): TurnoWeb[] {
  const set = new Set<TurnoWeb>();
  for (const f of filas || []) {
    if (f?.turno === "comida" || f?.turno === "cena") set.add(f.turno);
  }
  return [...set];
}

/** ¿La hora cae en un servicio bloqueado? */
export function horaEnServicioBloqueado(hora: string, turnosBloqueados: ReadonlyArray<TurnoWeb>): boolean {
  return turnosBloqueados.includes(turnoDeHoraWeb(hora));
}

/** ¿Es hoy y la hora está en la franja que solo se reserva por teléfono? */
export function esMismoDiaSoloTelefono(fecha: string, hora: string, fechaHoy: string): boolean {
  if (fecha !== fechaHoy) return false;
  const h = hhmm(hora);
  return h >= MISMO_DIA_TELEFONO_DESDE && h <= MISMO_DIA_TELEFONO_HASTA;
}

export function rechazoServicioBloqueado(hora: string, turnosBloqueados: ReadonlyArray<TurnoWeb>): RechazoBloqueoWeb | null {
  if (!horaEnServicioBloqueado(hora, turnosBloqueados)) return null;
  return rechazo(CODIGO_SERVICIO_BLOQUEADO, "Ese servicio ya no admite reservas online. Llámanos por teléfono.");
}

export function rechazoMismoDiaTelefono(fecha: string, hora: string, fechaHoy: string): RechazoBloqueoWeb | null {
  if (!esMismoDiaSoloTelefono(fecha, hora, fechaHoy)) return null;
  return rechazo(CODIGO_MISMO_DIA_TELEFONO, "Para comer hoy hay que reservar por teléfono.");
}

/** Solo `=== true` es sí (igual que las casillas RGPD). */
export function leerMenuDelDia(body: Record<string, unknown> | null | undefined): boolean {
  return body?.menu_del_dia === true;
}

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** 0 = domingo … 6 = sábado, sin zona horaria. */
function diaSemana(fecha: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/**
 * Menú del día: martes a jueves, turno de comida y, si se pide sala, solo
 * Comedor o Terraza. `salaPedida` = nombre de la sala que manda el cliente
 * (o el del `espacio_id` que manda); `null` si no pide ninguna.
 */
export function rechazoMenuDelDia(
  menuDelDia: boolean,
  fecha: string,
  hora: string,
  salaPedida: string | null,
): RechazoBloqueoWeb | null {
  if (!menuDelDia) return null;
  const dia = diaSemana(fecha);
  if (dia === null || !DIAS_MENU_DEL_DIA.includes(dia)) {
    return rechazo(CODIGO_MENU_DIA_NO_DISPONIBLE, "El menú del día solo se sirve de martes a jueves al mediodía.");
  }
  if (turnoDeHoraWeb(hora) !== "comida") {
    return rechazo(CODIGO_MENU_DIA_NO_DISPONIBLE, "El menú del día solo se sirve al mediodía (comida).");
  }
  if (salaPedida && !SALAS_MENU_DEL_DIA.includes(sinTildes(salaPedida))) {
    return rechazo(CODIGO_MENU_DIA_NO_DISPONIBLE, "El menú del día solo se sirve en el Comedor o en la Terraza.");
  }
  return null;
}

/**
 * Para /disponibilidad: por qué NO se ofrece una hora a la web aunque el motor
 * la dé por libre (`null` si se puede ofrecer).
 */
export function motivoHoraNoOfrecidaWeb(
  fecha: string,
  hora: string,
  fechaHoy: string,
  turnosBloqueados: ReadonlyArray<TurnoWeb>,
): typeof CODIGO_SERVICIO_BLOQUEADO | typeof CODIGO_MISMO_DIA_TELEFONO | null {
  if (horaEnServicioBloqueado(hora, turnosBloqueados)) return CODIGO_SERVICIO_BLOQUEADO;
  if (esMismoDiaSoloTelefono(fecha, hora, fechaHoy)) return CODIGO_MISMO_DIA_TELEFONO;
  return null;
}
