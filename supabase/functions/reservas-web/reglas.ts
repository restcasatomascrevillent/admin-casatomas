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
