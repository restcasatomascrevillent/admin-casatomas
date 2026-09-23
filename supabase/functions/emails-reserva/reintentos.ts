// ============================================================================
// REINTENTO DE CORREOS FALLIDOS — funciones puras, sin I/O
// ============================================================================
// Diagnóstico verificado en index.ts (ANTES de este módulo): un correo cuyo
// envío a Resend falla se marca `resultado='fallido'` en `envios_email_reserva`
// (con el motivo en `error`) y ahí se queda para siempre — nada lo reintenta,
// nada avisa a nadie (ver docs/CAPACIDAD-RESERVAS-EMAIL.md, sección "Qué pasa
// hoy si Resend falla al mandar un correo", confirmado leyendo
// marcarResultadoEnvio/enviarCorreoParaReserva antes de este cambio: solo
// dos resultados posibles, 'enviado' o 'fallido', sin tercer estado y sin
// ningún cron que vuelva a mirar las filas 'fallido').
//
// Este módulo aporta las DECISIONES puras que necesita el mecanismo de
// reintento (index.ts hace el I/O: leer/escribir `envios_email_reserva`,
// llamar a Resend, insertar en `notificaciones_dashboard`) — mismo criterio
// de separación que recordatorios.ts/ausencias.ts/envio-prueba.ts.
//
// LAS CUATRO PREGUNTAS QUE RESUELVE:
//   1. ¿Este fallo merece reintentarse, o es permanente?  -> clasificarErrorEnvio
//   2. ¿Cuánto hay que esperar antes del próximo intento?  -> calcularBackoffMs /
//      calcularProximoReintento
//   3. ¿Le toca ya, o hay que esperar más / ya se agotaron los intentos?
//      -> esReintentableAhora / seHanAgotadoLosIntentos
//   4. ¿Toca avisar al personal, o nos comeríamos un aluvión de avisos?
//      -> debeCrearAvisoLote / construirAvisoLote
//
// GARANTÍA CONTRA DUPLICADOS (punto central del encargo) — ver el razonamiento
// completo en la cabecera de index.ts junto a `enviarPorResendConIdempotencia`.
// Resumen: Resend admite una `Idempotency-Key` por petición (documentado en
// resend.com/docs/api-reference/emails/send-email y
// resend.com/changelog/idempotency-keys, consultado 22-09-2026): la misma
// clave + el mismo payload dentro de 24h devuelve el `id` del envío original
// SIN mandar un segundo correo; la misma clave con payload distinto responde
// 409 `invalid_idempotent_request` en vez de reintentar. Aquí la clave se
// deriva del id de la propia fila de `envios_email_reserva` (claveIdempotenciaEnvio),
// que es estable durante todo el ciclo de vida de esa fila (se reutiliza en
// cada reintento porque el reintento hace UPDATE de la misma fila, nunca
// INSERT de una fila nueva) — así, si un intento anterior falló de forma
// ambigua (excepción de red, no sabemos si Resend llegó a procesarlo),
// reintentar con la MISMA clave es seguro: o Resend nunca lo recibió (lo
// manda ahora) o sí lo recibió (devuelve el mismo id sin mandarlo otra vez).
// Ver el SDK resend-node@2.0.0 (versión ya fijada en este proyecto,
// comprobado contra su código fuente): `send()` acepta un segundo argumento
// `CreateEmailRequestOptions`, pero en ESA versión ese tipo solo declara
// `query` (no `idempotencyKey` — se añadió en una versión posterior del
// SDK). Por eso el envío real (no el de prueba) se hace aquí con `fetch`
// directo a la API HTTP de Resend en vez de con el método `.send()` del SDK:
// así se controla la cabecera `Idempotency-Key` sin depender de que la
// versión del SDK la soporte, y además se obtiene el status HTTP real de la
// respuesta en vez de un campo `statusCode` que el propio SDK reconoce que a
// veces no incluye (ver comentario ya existente en envio-prueba.ts sobre
// resend-node#286).
// ============================================================================

import type { TipoPlantilla } from "./plantillas.ts";
import { formatearHora } from "./plantillas.ts";

// ----------------------------------------------------------------------------
// 1. Clasificación del fallo: ¿reintentable o permanente?
// ----------------------------------------------------------------------------
// Basado en la taxonomía documentada de Resend (resend.com/docs/api-reference/
// errors, consultado 22-09-2026):
//   429 rate_limit_exceeded / daily_quota_exceeded / monthly_quota_exceeded
//       -> transitorio a ojos de este mecanismo. Aunque una cuota diaria/
//          mensual agotada no se arregla con un backoff de minutos, el
//          propio límite de intentos (seHanAgotadoLosIntentos) acota el daño:
//          si de verdad no hay cuota, se acaban agotando los reintentos y se
//          avisa al personal igualmente, que es la reacción correcta.
//   5xx (application_error, service_unavailable, y cualquier 5xx no listado)
//       -> transitorio por definición (fallo del lado de Resend).
//   409 concurrent_idempotent_requests -> "hay otra petición con esta misma
//       clave en curso, prueba en un momento" -> transitorio.
//   409 invalid_idempotent_request -> el payload cambió respecto al primer
//       intento con esta misma clave de idempotencia. Reintentar NUNCA lo
//       arregla sin cambiar la clave o el payload (documentado tal cual por
//       Resend) -> permanente.
//   400/401/403/404/405/422 (validation_error, missing_api_key,
//       restricted_api_key, missing_required_field, invalid_parameter, etc.)
//       -> errores de contenido, credenciales o formato. Repetir la MISMA
//       petición nunca cambia el resultado -> permanente.
//   Sin respuesta HTTP (status null: excepción de red, timeout, DNS...)
//       -> se asume transitorio. Es deliberadamente optimista: no hay forma
//       de distinguir aquí "Resend caído" de "problema de red nuestro", y en
//       ambos casos esperar y reintentar es la reacción correcta. El límite
//       de intentos evita que esto reintente para siempre si el problema no
//       es transitorio de verdad.
// ----------------------------------------------------------------------------

export interface ErrorEnvioResend {
  /** Status HTTP real de la respuesta de Resend, o `null` si no hubo
   * respuesta (excepción de red/timeout antes de recibir nada). */
  status: number | null;
  name?: string | null;
  message?: string | null;
}

export interface ClasificacionError {
  reintentable: boolean;
  /** Clave corta para logs y para decidir el tono del aviso al personal
   * (ver construirAvisoLote) — nunca sustituye a guardar el mensaje real de
   * Resend en `envios_email_reserva.error`. */
  motivo: string;
}

export function clasificarErrorEnvio(err: ErrorEnvioResend): ClasificacionError {
  const status = err.status;
  const nombre = (err.name ?? "").toLowerCase().trim();

  if (status === null || status === undefined) {
    return { reintentable: true, motivo: "sin_respuesta_http" };
  }
  if (status === 429) {
    return { reintentable: true, motivo: nombre ? `limite_${nombre}` : "limite_429" };
  }
  if (status >= 500) {
    return { reintentable: true, motivo: `error_servidor_${status}` };
  }
  if (status === 409) {
    if (nombre === "invalid_idempotent_request") {
      return { reintentable: false, motivo: "payload_cambio_con_misma_clave" };
    }
    // concurrent_idempotent_requests u otro 409 no documentado: se asume
    // conflicto transitorio ("prueba en un momento"), nunca un rechazo de
    // contenido — los 409 de Resend nunca son "destinatario inválido".
    return { reintentable: true, motivo: nombre ? `conflicto_${nombre}` : "conflicto_409" };
  }
  // 400 (validation_error, invalid_idempotency_key), 401/403 (credenciales,
  // sandbox, permisos), 404/405 (ruta/método), 422 (campos obligatorios,
  // adjuntos, parámetros inválidos) -> ninguno se arregla repitiendo la
  // misma petición.
  return { reintentable: false, motivo: nombre ? `permanente_${nombre}` : `permanente_${status}` };
}

// ----------------------------------------------------------------------------
// 2. Espera creciente entre reintentos
// ----------------------------------------------------------------------------
// Base 10 minutos, factor x2, tope 6 horas: 10 -> 20 -> 40 -> 80 min entre
// intentos sucesivos. Con MAX_INTENTOS_POR_DEFECTO = 5 (1 intento original +
// 4 reintentos), el último reintento cae sobre los 10+20+40+80 = 150 minutos
// (2h30) después del fallo original, muy por debajo de las 24h que Resend
// conserva la clave de idempotencia (sección de arriba) — la garantía
// contra duplicados cubre TODA la ventana de reintento con margen de sobra.
// ----------------------------------------------------------------------------

export const MAX_INTENTOS_POR_DEFECTO = 5;
export const BACKOFF_BASE_MS_POR_DEFECTO = 10 * 60 * 1000;
export const BACKOFF_FACTOR_POR_DEFECTO = 2;
export const BACKOFF_MAX_MS_POR_DEFECTO = 6 * 60 * 60 * 1000;

export function calcularBackoffMs(
  intentosPrevios: number,
  base = BACKOFF_BASE_MS_POR_DEFECTO,
  factor = BACKOFF_FACTOR_POR_DEFECTO,
  max = BACKOFF_MAX_MS_POR_DEFECTO,
): number {
  const previos = Math.max(1, intentosPrevios);
  const ms = base * Math.pow(factor, previos - 1);
  return Math.min(ms, max);
}

/** `ahoraIso` + el backoff correspondiente a `intentosPrevios`, en ISO 8601. */
export function calcularProximoReintento(
  ahoraIso: string,
  intentosPrevios: number,
  base = BACKOFF_BASE_MS_POR_DEFECTO,
  factor = BACKOFF_FACTOR_POR_DEFECTO,
  max = BACKOFF_MAX_MS_POR_DEFECTO,
): string {
  const ms = calcularBackoffMs(intentosPrevios, base, factor, max);
  return new Date(new Date(ahoraIso).getTime() + ms).toISOString();
}

// ----------------------------------------------------------------------------
// 3. Elegibilidad: ¿a esta fila 'fallido' le toca ya un reintento?
// ----------------------------------------------------------------------------

export function seHanAgotadoLosIntentos(intentos: number, maxIntentos = MAX_INTENTOS_POR_DEFECTO): boolean {
  return intentos >= maxIntentos;
}

export interface FilaFallidaElegible {
  resultado: string;
  intentos: number;
  /** ISO 8601, o null si nunca se calculó (fila antigua / primer fallo aún
   * sin backoff asignado -> se trata como "ya toca"). */
  proximo_reintento_en: string | null;
}

/** Verdadero si esta fila 'fallido' debe intentarse YA: no ha agotado el
 * máximo de intentos y ya ha pasado su hora de reintento (o nunca se le
 * asignó una). Pura: recibe "ahora" en vez de leerlo (mismo criterio que
 * filaEstaAbandonada en resend-lote.ts). */
export function esReintentableAhora(
  fila: FilaFallidaElegible,
  ahoraIso: string,
  maxIntentos = MAX_INTENTOS_POR_DEFECTO,
): boolean {
  if (fila.resultado !== "fallido") return false;
  if (seHanAgotadoLosIntentos(fila.intentos, maxIntentos)) return false;
  if (!fila.proximo_reintento_en) return true;
  return new Date(fila.proximo_reintento_en).getTime() <= new Date(ahoraIso).getTime();
}

/**
 * Verdadero si el tipo de correo que registra la fila sigue siendo el que
 * corresponde al estado ACTUAL de la reserva. Si la reserva avanzó a otro
 * estado desde el fallo original (p.ej. se canceló mientras la 'propuesta'
 * seguía fallida), reintentar mandaría un correo obsoleto/contradictorio —
 * ese caso no es un fallo de entrega, es que el mundo cambió, y se trata
 * distinto (se abandona sin contar como "correo perdido" para el aviso: la
 * reserva ya tiene, o tendrá, su propio correo para el estado nuevo a través
 * del flujo normal).
 *
 * CASO ESPECIAL — 'recordatorio': a diferencia de solicitud_recibida/
 * propuesta/confirmada/rechazada, el recordatorio NO lo dispara una
 * transición de estado (no existe ningún `estado` de `reservas` que
 * `tipoEmailParaEstado` traduzca a 'recordatorio' — lo dispara el cron de
 * T-2 días sobre reservas que ya están 'confirmada', y la reserva SIGUE
 * 'confirmada' después de enviarlo). Comparar contra
 * `tipoEmailParaEstadoActual` (que para una reserva 'confirmada' vale
 * 'confirmada', nunca 'recordatorio') marcaría SIEMPRE como obsoleto un
 * recordatorio fallido, y ese es justo el caso que el encargo señala como
 * el más grave de arreglar ("si falla ese día, nunca se reintenta"). Por
 * eso el recordatorio se juzga vigente con su propia regla: sigue vigente
 * mientras la reserva siga 'confirmada' (si se canceló entre medias, ya no
 * tiene sentido recordar una reserva que ya no está en pie).
 */
export function tipoDeEmailSigueVigente(
  tipoEmailFila: string,
  reservaEstadoActual: string,
  tipoEmailParaEstadoActual: TipoPlantilla | null,
): boolean {
  if (tipoEmailFila === "recordatorio") {
    return reservaEstadoActual === "confirmada";
  }
  return tipoEmailParaEstadoActual !== null && tipoEmailFila === tipoEmailParaEstadoActual;
}

// ----------------------------------------------------------------------------
// 4. Clave de idempotencia — estable por fila, reutilizada en cada reintento
// ----------------------------------------------------------------------------

export function claveIdempotenciaEnvio(envioId: string): string {
  // Prefijo descriptivo (Resend permite hasta 256 caracteres): ayuda a
  // reconocer el origen de la petición si algún día hay que depurar contra
  // los propios logs/dashboard de Resend.
  return `envio-email-reserva/${envioId}`;
}

// ----------------------------------------------------------------------------
// 5. Aviso al personal cuando un correo se da por perdido — agrupado para no
//    generar un aluvión si Resend falla para varias reservas seguidas.
// ----------------------------------------------------------------------------

export const AVISO_COOLDOWN_MINUTOS_POR_DEFECTO = 30;

/** Valor de `notificaciones_dashboard.origen` para avisos de ESTA función —
 * ver "MARGEN ANTI-ALUVIÓN COMPARTIDO ENTRE TUBERÍAS: por qué origen Y
 * prioridad" más abajo, junto a `prioridadEmailFallido`. */
export const ORIGEN_EMAILS_RESERVA = "emails_reserva";

/**
 * Verdadero si toca crear un aviso nuevo en `notificaciones_dashboard`.
 * `ultimoAvisoCreadoAt` es el `created_at` del aviso más reciente de tipo
 * 'email_fallido' (o null si nunca hubo uno). Defensa contra aluvión: como
 * mucho un aviso nuevo cada `cooldownMinutos`, sin importar cuántas filas se
 * hayan dado por perdidas en medio — se agrupan todas en el próximo aviso
 * permitido (ver construirAvisoLote). Es una protección deliberadamente
 * simple (mejor pecar de avisar de menos en una caída muy larga que mandar
 * doscientos avisos en diez minutos, que es el escenario que el encargo pide
 * evitar explícitamente) — no es un contador exacto por reserva, igual que
 * comprobarLimitePrueba en index.ts tampoco lo es para su propio caso.
 *
 * BUG ENCONTRADO Y CORREGIDO AQUÍ (verificado en la prueba de QA: un fallo
 * de "solicitud recibida" tapó 30 minutos el aviso de una "propuesta"/
 * "confirmación" de OTRA reserva): `ultimoAvisoCreadoAt` DEBE venir ya
 * filtrado por `origen='emails_reserva'` Y por la MISMA `prioridad` que el
 * aviso que se quiere crear (ver `avisarEnviosDefinitivamentePerdidos` en
 * index.ts, que hace ese filtro) — antes de este cambio, el filtro era solo
 * `tipo='email_fallido'`, así que un aviso de baja prioridad de CUALQUIER
 * tubería (incluida `reservas-web`, otro origen por completo) podía tapar
 * uno de alta prioridad durante todo el cooldown. Ver `prioridadEmailFallido`
 * más abajo para el porqué de los DOS ejes (origen Y prioridad, no solo uno).
 */
export function debeCrearAvisoLote(
  ultimoAvisoCreadoAt: string | null,
  ahoraIso: string,
  cooldownMinutos = AVISO_COOLDOWN_MINUTOS_POR_DEFECTO,
): boolean {
  if (!ultimoAvisoCreadoAt) return true;
  const transcurridoMs = new Date(ahoraIso).getTime() - new Date(ultimoAvisoCreadoAt).getTime();
  return transcurridoMs >= cooldownMinutos * 60 * 1000;
}

export interface EnvioPerdido {
  reservaId: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  fecha: string;
  hora: string;
  tipoEmail: string;
  /** Motivo corto de clasificarErrorEnvio, o una clave propia como
   * "resend_no_configurado" — permite distinguir "hay que llamar al
   * cliente" de "hay que revisar la configuración". */
  motivo: string;
}

const ETIQUETA_TIPO_EMAIL: Record<string, string> = {
  solicitud_recibida: "solicitud recibida",
  propuesta: "propuesta de reserva",
  confirmada: "confirmación de reserva",
  rechazada: "aviso de cancelación",
  recordatorio: "recordatorio",
};

function etiquetaTipoEmail(tipo: string): string {
  return ETIQUETA_TIPO_EMAIL[tipo] ?? tipo;
}

function esProblemaDeConfiguracion(motivo: string): boolean {
  return motivo === "resend_no_configurado";
}

export type PrioridadAvisoEmailFallido = "alta" | "normal";

/**
 * MARGEN ANTI-ALUVIÓN COMPARTIDO ENTRE TUBERÍAS: por qué origen Y prioridad
 * -----------------------------------------------------------------------
 * "Por origen" (ORIGEN_EMAILS_RESERVA arriba) ya arregla el caso exacto de
 * la prueba de QA (solicitud_recibida es de reservas-web; propuesta/
 * confirmada son de emails-reserva — orígenes distintos, cooldowns ya
 * independientes con solo ese filtro). Pero ESTA MISMA tubería manda tanto
 * tipos de baja prioridad (solicitud_recibida, rechazada, recordatorio)
 * como de alta (propuesta, confirmada) — así que "por origen" solo deja un
 * riesgo residual: un solicitud_recibida fallido podría tapar, DENTRO de
 * emails-reserva, un propuesta/confirmada fallido posterior. De ahí el
 * segundo eje: la prioridad se calcula por tipo de correo (y por motivo,
 * para "resend_no_configurado" — ver abajo) y el cooldown se comprueba solo
 * contra avisos de la MISMA prioridad (ver `avisarEnviosDefinitivamentePerdidos`
 * en index.ts). Combinados dan 4 carriles independientes: (emails_reserva,
 * alta) / (emails_reserva,normal), más los 2 equivalentes de reservas-web
 * (ver `prioridadAvisoEmailFallido`/`ORIGEN_RESERVAS_WEB` en
 * `reservas-web/plantillas.ts` — mismo criterio, duplicado porque las dos
 * Edge Functions no comparten módulos entre sí; `_shared/` queda fuera del
 * territorio de esta sesión).
 *
 * CLASIFICACIÓN:
 *   'alta': 'propuesta'/'confirmada' — el cliente se queda sin el correo
 *     que lleva la acción pendiente (aceptar/rechazar una propuesta, o la
 *     confirmación ya cerrada). También 'alta' si el motivo es
 *     "resend_no_configurado": ese problema bloquea TODOS los envíos, no
 *     solo el que se está avisando, y merece atención inmediata sin
 *     importar qué plantilla lo disparó primero.
 *   'normal': el resto (solicitud_recibida, rechazada, recordatorio) —
 *     informativo, sin acción pendiente que dependa del correo en sí.
 */
export function prioridadEmailFallido(tipoEmail: string, motivo: string): PrioridadAvisoEmailFallido {
  if (esProblemaDeConfiguracion(motivo)) return "alta";
  return tipoEmail === "propuesta" || tipoEmail === "confirmada" ? "alta" : "normal";
}

function contactoDe(p: EnvioPerdido): string {
  return p.telefono || p.email || "sin contacto";
}

/**
 * Construye título + mensaje del aviso agrupado. `null` si no hay nada que
 * avisar. Un solo elemento se redacta en singular y señala la reserva
 * concreta; más de uno se agrupa en un único aviso (nunca uno por reserva)
 * — es la pieza que evita el aluvión de verdad cuando Resend fallara para
 * varias reservas dentro del mismo cooldown.
 */
export function construirAvisoLote(perdidos: readonly EnvioPerdido[]): { titulo: string; mensaje: string } | null {
  if (perdidos.length === 0) return null;

  if (perdidos.length === 1) {
    const p = perdidos[0];
    if (esProblemaDeConfiguracion(p.motivo)) {
      return {
        titulo: `No se pudo enviar un correo de reserva (${etiquetaTipoEmail(p.tipoEmail)})`,
        mensaje: `${p.nombre || "Cliente"} · ${contactoDe(p)} · ${p.fecha} ${formatearHora(p.hora)}. Revisa la configuración de Resend (RESEND_API_KEY) — hasta entonces no saldrá ningún correo.`,
      };
    }
    return {
      titulo: `No se pudo enviar un correo de reserva (${etiquetaTipoEmail(p.tipoEmail)})`,
      mensaje: `${p.nombre || "Cliente"} · ${contactoDe(p)} · ${p.fecha} ${formatearHora(p.hora)}. Llama para confirmarlo a mano.`,
    };
  }

  const MOSTRAR_MAX = 5;
  const listados = perdidos.slice(0, MOSTRAR_MAX).map((p) => `${p.nombre || "Cliente"} (${contactoDe(p)})`).join(", ");
  const resto = perdidos.length > MOSTRAR_MAX ? ` y ${perdidos.length - MOSTRAR_MAX} más` : "";
  const algunoConfig = perdidos.some((p) => esProblemaDeConfiguracion(p.motivo));

  return {
    titulo: `${perdidos.length} correos de reserva no se pudieron enviar`,
    mensaje: algunoConfig
      ? `Puede que falte configurar Resend (RESEND_API_KEY). Clientes afectados: ${listados}${resto}. Llama a los que puedas mientras se resuelve.`
      : `Puede que Resend esté fallando. Llama para confirmar a mano a: ${listados}${resto}.`,
  };
}
