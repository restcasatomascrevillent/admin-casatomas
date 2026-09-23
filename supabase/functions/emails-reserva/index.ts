// ============================================================================
// EMAILS-RESERVA — Edge Function
// ============================================================================
// Sistema de correos de reserva: contraoferta, plantillas editables desde el
// panel (contrato en plantillas.ts), recordatorio a T-2 días y detección de
// ausencias sin avisar (sugerencia de lista negra, nunca veto automático).
//
// Rutas (todas bajo /functions/v1/emails-reserva/...):
//   POST /notificar               JSON  -> envía el correo que toque según
//                                           el estado ACTUAL de la reserva
//                                           (llamada por notify-reservation-
//                                           change; sustituye a la llamada
//                                           que antes iba a reservas-web)
//   POST /recordatorios           JSON  -> lote de recordatorios T-2 (cron)
//   POST /detectar-ausencias      JSON  -> marca no_show + crea sugerencias
//                                           de lista negra (cron)
//   POST /reintentar-fallidos     JSON  -> reintenta envíos 'fallido' con
//                                           espera creciente (cron, NUEVO —
//                                           ver 20260922160000_reintentos_
//                                           emails_reserva.sql y reintentos.ts
//                                           para el razonamiento completo:
//                                           qué se reintenta, qué no, y la
//                                           garantía contra duplicados vía
//                                           Idempotency-Key de Resend)
//   POST /enviar-prueba           JSON  -> renderiza el BORRADOR que trae el
//                                           editor del panel (aún sin
//                                           guardar) con datos de ejemplo y
//                                           lo manda SOLO al email del
//                                           usuario autenticado que llama.
//                                           No toca envios_email_reserva —
//                                           no es un envío real, no debe
//                                           consumir su idempotencia ni
//                                           contaminar el historial.
//   GET  /aceptar?token=...       HTML  -> acepta la contraoferta (1 uso)
//   GET  /rechazar?token=...      HTML  -> pantalla "¿seguro?" (no muta)
//   GET  /rechazar/ejecutar?token=...  HTML -> rechaza de verdad
//
//   PROPUESTA DESDE UNA SOLICITUD DEL BOT (2026-09-23, ver
//   propuesta-solicitud.ts y la migración 20260923210000):
//   POST /enviar-propuesta-solicitud  JSON -> la llama el panel (JWT de
//                                           usuario + can_write_section,
//                                           igual que /enviar-prueba); manda
//                                           la plantilla 'propuesta' con los
//                                           datos guardados en la solicitud
//   GET  /propuesta/aceptar?token=...           HTML -> "¿confirmas?" (no muta)
//   GET  /propuesta/aceptar/ejecutar?token=...  HTML -> crea la reserva
//                                           (fn_aceptar_propuesta_solicitud)
//   GET  /propuesta/rechazar?token=...          HTML -> "¿seguro?" (no muta)
//   GET  /propuesta/rechazar/ejecutar?token=... HTML -> marca rechazada
//   Aceptar va en DOS pasos (a diferencia de /aceptar de la contraoferta)
//   porque aquí crea una reserva nueva: un escáner de correo que precargue
//   el enlace no debe poder crearla.
//
// verify_jwt = false (ver config.toml) PARA TODA LA FUNCIÓN — no puede ser
// true a nivel de función porque las rutas GET las pulsa el cliente desde su
// correo, sin ninguna cabecera. La autenticación real de esas rutas es el
// token HMAC de un solo uso (tokens.ts). Las rutas POST /notificar,
// /recordatorios, /detectar-ausencias y /reintentar-fallidos exigen la
// cabecera `x-webhook-secret`
// (comprobarSecretoCompartido, FALLA CERRADO si falta la env var — ver el
// aviso sobre checkSharedSecret de reservas-web en
// docs/REVISION-PUERTOS-N8N.md A-3, que aquí se decide no repetir).
//
// POST /enviar-prueba es distinta de las otras POST: la llama el navegador
// con la sesión del usuario del panel, no un cron ni un servicio interno, así
// que NO comprueba `x-webhook-secret` — comprueba el JWT de usuario a mano
// (autenticarUsuarioPanel, mismo patrón que procesar-factura/index.ts) más
// `can_write_section('reservas')` (misma comprobación que ya hace
// fn_restaurar_version_plantilla en la migración pendiente). Ir a
// verify_jwt=true a nivel de función NO serviría como autenticación aquí
// igualmente (la anon key es un JWT válido y viaja en el bundle público del
// panel — colaría en cualquier gateway que solo mire "¿hay un JWT?"), y
// además rompería las rutas GET de arriba, que no mandan ninguna cabecera.
//
// Secrets requeridos (Deno.env):
//   SUPABASE_URL, SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY                 (los inyecta la plataforma)
//   RESEND_API_KEY                            (ya existe en el proyecto)
//   EMAILS_RESERVA_SHARED_SECRET              (NUEVO — rutas internas)
//   EMAILS_RESERVA_TOKEN_SECRET               (NUEVO — firma HMAC de aceptar/rechazar)
// Opcionales:
//   RESEND_FROM_EMAIL           (por defecto: sandbox de Resend, ver informe)
//   EMAILS_RESERVA_PUBLIC_URL   (base de los enlaces de los correos)
//   EMAILS_RESERVA_LOTE_TAMANO, EMAILS_RESERVA_LOTE_PAUSA_MS  (ver resend-lote.ts)
// ============================================================================

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

import { renderPlantilla, escapeHtml, TIPOS_PLANTILLA, type TipoPlantilla, type FilaPlantilla, type DatosReservaParaCorreo } from "./plantillas.ts";
import {
  seleccionarReservasParaRecordatorio,
  fechaObjetivoRecordatorio,
  enLotes,
  type ReservaParaRecordatorio,
} from "./recordatorios.ts";
import { esAusenciaSinAvisar, resumirHistorialCliente, type ReservaHistorialCliente } from "./ausencias.ts";
import { firmarToken, verificarToken, calcularHuella } from "./tokens.ts";
import {
  TAMANO_LOTE_POR_DEFECTO,
  PAUSA_ENTRE_LOTES_MS_POR_DEFECTO,
  leerEnteroEnv,
  filaEstaAbandonada,
  esperar,
} from "./resend-lote.ts";
import { instanteMadridAFechaUtc, hoyEnMadridIso, ahoraIso } from "./tiempo.ts";
import {
  datosEjemploParaTipo,
  validarPlantillaBorrador,
  esErrorSandboxResend,
  superaLimiteDePrueba,
} from "./envio-prueba.ts";
import {
  clasificarErrorEnvio,
  calcularProximoReintento,
  seHanAgotadoLosIntentos,
  esReintentableAhora,
  tipoDeEmailSigueVigente,
  claveIdempotenciaEnvio,
  debeCrearAvisoLote,
  construirAvisoLote,
  prioridadEmailFallido,
  ORIGEN_EMAILS_RESERVA,
  MAX_INTENTOS_POR_DEFECTO,
  type EnvioPerdido,
  type PrioridadAvisoEmailFallido,
} from "./reintentos.ts";
import {
  validarSolicitudParaEnvio,
  huellaPropuestaSolicitud,
  datosCorreoPropuestaSolicitud,
  claveIdempotenciaPropuestaSolicitud,
  epochSegundos,
  paginaTrasAceptar,
  horaCorta,
  MENSAJE_ERROR_ENVIO,
  type SolicitudParaPropuesta,
} from "./propuesta-solicitud.ts";

// ------------------------------------------------------------
// CONFIGURACIÓN
// ------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Solo para /enviar-prueba: un cliente con la sesión del USUARIO (no la
// service role) para poder validar su JWT y comprobar su permiso de sección
// con su propio auth.uid() — mismo motivo que supabaseUser en
// procesar-factura/index.ts:autenticar. La inyecta la plataforma sola.
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Casa Tomás <onboarding@resend.dev>";
const SHARED_SECRET = Deno.env.get("EMAILS_RESERVA_SHARED_SECRET") ?? "";
const TOKEN_SECRET = Deno.env.get("EMAILS_RESERVA_TOKEN_SECRET") ?? "";
const PUBLIC_BASE_URL = Deno.env.get("EMAILS_RESERVA_PUBLIC_URL") || `${SUPABASE_URL}/functions/v1/emails-reserva`;
const TAMANO_LOTE = leerEnteroEnv(Deno.env.get("EMAILS_RESERVA_LOTE_TAMANO"), TAMANO_LOTE_POR_DEFECTO);
const PAUSA_LOTE_MS = leerEnteroEnv(Deno.env.get("EMAILS_RESERVA_LOTE_PAUSA_MS"), PAUSA_ENTRE_LOTES_MS_POR_DEFECTO);
// Cuántas filas 'fallido' se evalúan como máximo en una sola ejecución de
// /reintentar-fallidos. 50 es ya más que el día más cargado que hay
// registrado en el sistema (ver docs/CAPACIDAD-RESERVAS-EMAIL.md, sección
// 3: 50 reservas ese día) — de sobra para drenar cualquier atasco real en
// una sola pasada, y el cron vuelve a pasar cada 15 minutos si algo queda.
const MAX_FILAS_REINTENTO = leerEnteroEnv(Deno.env.get("EMAILS_RESERVA_REINTENTO_MAX_FILAS"), 50);

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const resend = new Resend(RESEND_API_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const RESTAURANTE_TEL_TEXTO = "966 10 78 87";
const RESTAURANTE_TEL_HREF = "966107887";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

// FALLA CERRADO a propósito: checkSharedSecret de reservas-web falla ABIERTO
// si falta la env var (docs/REVISION-PUERTOS-N8N.md, A-3). Aquí, sin
// secreto configurado, se rechaza todo — ver también el aviso `raise
// notice` de la migración si falta el secreto en Vault.
function comprobarSecretoCompartido(req: Request): boolean {
  if (!SHARED_SECRET) {
    console.error("[emails-reserva] EMAILS_RESERVA_SHARED_SECRET no configurado — rechazando (fail closed)");
    return false;
  }
  return req.headers.get("x-webhook-secret") === SHARED_SECRET;
}

// ------------------------------------------------------------
// ACCESO A DATOS
// ------------------------------------------------------------
interface ReservaRow {
  id: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  fecha: string;
  hora: string;
  numero_comensales: number;
  estado: string;
  espacio_id: string | null;
  hora_solicitada: string | null;
  espacio_solicitado_id: string | null;
}

async function fetchReserva(id: string): Promise<ReservaRow | null> {
  const { data, error } = await supabase
    .from("reservas")
    .select("id, nombre, telefono, email, fecha, hora, numero_comensales, estado, espacio_id, hora_solicitada, espacio_solicitado_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as ReservaRow;
}

/** Solo 3 filas hoy (Comedor/Salón/Terraza) — se consulta fresco en cada
 * llamada en vez de cachear en el isolate, para no arriesgar un nombre
 * obsoleto si alguien edita espacios_reserva. */
async function obtenerMapaEspacios(): Promise<Map<string, string>> {
  const { data } = await supabase.from("espacios_reserva").select("id, nombre");
  return new Map(((data ?? []) as Array<{ id: string; nombre: string }>).map((e) => [e.id, e.nombre]));
}

function tipoEmailParaEstado(estado: string): TipoPlantilla | null {
  switch (estado) {
    case "pendiente":
      return "solicitud_recibida";
    case "verificada":
      return "propuesta";
    case "confirmada":
      return "confirmada";
    case "cancelada":
      return "rechazada";
    default:
      // 'completada' y 'no_show' no disparan correo.
      return null;
  }
}

async function obtenerPlantillaActual(tipo: TipoPlantilla): Promise<FilaPlantilla | null> {
  const { data, error } = await supabase
    .from("plantillas_email_reserva")
    .select("*")
    .eq("tipo", tipo)
    .eq("es_actual", true)
    .maybeSingle();
  if (error || !data) return null;
  return data as FilaPlantilla;
}

/**
 * NUEVO (punto 1 del encargo, la parte "valora si conviene no volver a
 * escribir a esa dirección" del caso 'complained'): `direcciones_email_
 * suprimidas` la puebla resend-webhook al recibir bounced/complained/
 * suppressed (ver su migración e index.ts) — aquí solo se consulta, antes
 * de intentar un envío, para no seguir escribiendo a quien ya rebotó,
 * se quejó, o que Resend ya tiene suprimida. Fail-open a propósito
 * (mismo criterio que comprobarLimitePrueba más abajo en este fichero):
 * un fallo LEYENDO la tabla de supresión no debe bloquear un envío real
 * — no es una comprobación de seguridad, es una optimización de
 * reputación/deliverability, así que el peor caso de un fallo aquí es
 * mandar un correo de más, nunca dejar de mandar uno que sí tocaba.
 */
async function estaDireccionSuprimida(email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("direcciones_email_suprimidas")
    .select("email")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();
  if (error) {
    // "column/relation does not exist" es el caso esperable si la
    // migración de resend-webhook todavía no se ha aplicado — se deja
    // pasar igual que cualquier otro error de lectura (ver docstring).
    console.error("[emails-reserva] Error comprobando direcciones_email_suprimidas (se deja pasar):", error.message);
    return false;
  }
  return !!data;
}

async function construirDatosReserva(
  reserva: ReservaRow,
  urlsBotones?: { principal?: string; secundario?: string },
): Promise<DatosReservaParaCorreo> {
  const mapa = await obtenerMapaEspacios();
  return {
    nombre: reserva.nombre || "Cliente",
    fecha: reserva.fecha,
    hora: reserva.hora,
    comensales: reserva.numero_comensales,
    espacio: reserva.espacio_id ? mapa.get(reserva.espacio_id) ?? null : null,
    horaSolicitada: reserva.hora_solicitada,
    espacioSolicitado: reserva.espacio_solicitado_id ? mapa.get(reserva.espacio_solicitado_id) ?? null : null,
    botonPrincipalUrl: urlsBotones?.principal ?? null,
    botonSecundarioUrl: urlsBotones?.secundario ?? null,
  };
}

// ------------------------------------------------------------
// ENVÍO IDEMPOTENTE (ver PIEZA 3a de la migración para el razonamiento) +
// REINTENTO (ver 20260922160000_reintentos_emails_reserva.sql y
// reintentos.ts para el razonamiento completo)
// ------------------------------------------------------------
interface FilaEnvioAbandonable {
  id: string;
  creado_at: string;
}

async function liberarPendientesAbandonados(filtro: { reserva_id?: string; tipo_email?: string }): Promise<void> {
  let query = supabase.from("envios_email_reserva").select("id, creado_at").eq("resultado", "pendiente");
  if (filtro.reserva_id) query = query.eq("reserva_id", filtro.reserva_id);
  if (filtro.tipo_email) query = query.eq("tipo_email", filtro.tipo_email);
  const { data } = await query;
  const ahora = ahoraIso();
  for (const fila of (data ?? []) as FilaEnvioAbandonable[]) {
    if (filaEstaAbandonada(fila, ahora)) {
      await supabase.from("envios_email_reserva").update({ resultado: "fallido", error: "reclamado_por_timeout" }).eq("id", fila.id);
    }
  }
}

async function reclamarEnvio(
  reservaId: string,
  tipoEmail: TipoPlantilla,
  destinatario: string,
  plantillaId: string,
): Promise<{ id: string; creado_at: string } | null> {
  await liberarPendientesAbandonados({ reserva_id: reservaId, tipo_email: tipoEmail });

  // `creado_at` en el select — lo necesita construirCorreoParaTipo para el
  // token estable de 'propuesta' (punto 3 del encargo, ver su llamada en
  // enviarCorreoParaReserva más abajo).
  const { data, error } = await supabase
    .from("envios_email_reserva")
    .insert({ reserva_id: reservaId, tipo_email: tipoEmail, destinatario, plantilla_id: plantillaId, resultado: "pendiente" })
    .select("id, creado_at")
    .single();

  if (error) {
    // 23505 = unique_violation sobre uq_envio_email_reserva_activo -> ya
    // reclamado por otra ejecución o ya enviado con éxito. No es un fallo.
    if (error.code !== "23505") {
      console.error(`[emails-reserva] Error reclamando envio (${reservaId}/${tipoEmail}):`, error.message);
    }
    return null;
  }
  return { id: data.id as string, creado_at: data.creado_at as string };
}

async function marcarEnviado(id: string, resendId: string | null): Promise<void> {
  // `error: null` — BUG PRE-EXISTENTE ENCONTRADO Y CORREGIDO AQUÍ (fuera del
  // encargo original, pero dentro de mi territorio, punto 4): sin esto, una
  // fila que fallaba y luego se reintentaba con éxito quedaba 'enviado' pero
  // conservando el `error` del intento anterior — el panel podía mostrar un
  // motivo de fallo sobre un envío que sí se entregó. `enviado`/`fallido`/
  // `fallido_definitivo` son estados mutuamente excluyentes; solo estos dos
  // últimos deben dejar `error` relleno.
  const { error } = await supabase
    .from("envios_email_reserva")
    .update({ resultado: "enviado", resend_id: resendId, error: null, enviado_at: ahoraIso(), ultimo_intento_at: ahoraIso() })
    .eq("id", id);
  if (error) console.error(`[emails-reserva] Error marcando enviado ${id}:`, error.message);
}

/** Fallo transitorio: se queda 'fallido' (reintentable) con la hora del
 * próximo intento ya calculada, para que /reintentar-fallidos no tenga que
 * recalcularla a partir de nada más que esta misma fila. */
async function marcarFallidoReintentable(id: string, error: string, proximoReintentoEn: string): Promise<void> {
  const { error: errUpdate } = await supabase
    .from("envios_email_reserva")
    .update({ resultado: "fallido", error, proximo_reintento_en: proximoReintentoEn, ultimo_intento_at: ahoraIso() })
    .eq("id", id);
  if (errUpdate) console.error(`[emails-reserva] Error marcando fallido (reintentable) ${id}:`, errUpdate.message);
}

/** Fallo permanente, o transitorio que ya agotó sus intentos: estado final,
 * distinguible de 'fallido' a propósito (punto 2 del encargo) — nada vuelve
 * a mirar esta fila salvo un humano. */
async function marcarFallidoDefinitivo(id: string, error: string): Promise<void> {
  const { error: errUpdate } = await supabase
    .from("envios_email_reserva")
    .update({ resultado: "fallido_definitivo", error, proximo_reintento_en: null, ultimo_intento_at: ahoraIso() })
    .eq("id", id);
  if (errUpdate) console.error(`[emails-reserva] Error marcando fallido_definitivo ${id}:`, errUpdate.message);
}

// ------------------------------------------------------------
// ENVÍO REAL A RESEND — con Idempotency-Key (garantía contra duplicados)
// ------------------------------------------------------------
// Se llama a la API HTTP de Resend directamente con `fetch`, NO con
// `resend.emails.send()` del SDK (que sí se sigue usando, sin cambios, en
// handleEnviarPrueba — ese envío no se reintenta nunca, no tiene fila de
// envios_email_reserva de la que colgar una clave de idempotencia, y no
// tiene sentido dársela). Dos motivos, verificados ambos contra el código
// fuente real de la versión ya fijada en este proyecto (resend-node@2.0.0,
// esm.sh/resend@2.0.0) antes de decidir esto, no por sospecha:
//   1. Idempotencia: `CreateEmailRequestOptions` (segundo argumento de
//      `.send()`) en la v2.0.0 solo declara `query` — NO `idempotencyKey`
//      (se añadió en una versión posterior del SDK). Pasarlo igualmente no
//      lo mandaría como cabecera `Idempotency-Key`, así que daría una falsa
//      sensación de estar protegidos. Llamando a la API HTTP directamente
//      se controla la cabecera sin depender de que el SDK la soporte.
//   2. Status HTTP fiable: el objeto de error del SDK no siempre trae
//      `statusCode` (ver el comentario ya existente en envio-prueba.ts sobre
//      resend-node#286, que aquí también aplica). Con `fetch` directo el
//      status es el de la respuesta HTTP real, siempre presente, y es la
//      señal que usa clasificarErrorEnvio (reintentos.ts) para decidir si
//      vale la pena reintentar.
// La clave de idempotencia es `claveIdempotenciaEnvio(envioId)` — el id de
// la FILA de envios_email_reserva, que no cambia entre el intento original
// y cada reintento posterior (el reintento hace UPDATE de la misma fila,
// nunca INSERT de una nueva — ver reclamarReintento más abajo). Resend
// conserva esa clave 24h; toda la ventana de reintento de este mecanismo
// (ver MAX_INTENTOS_POR_DEFECTO/BACKOFF_* en reintentos.ts) cabe muy
// holgadamente dentro de esas 24h.
// ------------------------------------------------------------
const RESEND_SEND_URL = "https://api.resend.com/emails";
const RESEND_ENVIO_TIMEOUT_MS = 15000;

interface PayloadCorreo {
  from: string;
  to: string[];
  subject: string;
  html: string;
}

type ResultadoEnvioResend =
  | { ok: true; resendId: string | null }
  | { ok: false; status: number | null; name: string | null; message: string | null };

async function enviarPorResendConIdempotencia(payload: PayloadCorreo, idempotencyKey: string): Promise<ResultadoEnvioResend> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RESEND_ENVIO_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let cuerpo: Record<string, unknown> | null = null;
    try {
      cuerpo = (await response.json()) as Record<string, unknown>;
    } catch {
      cuerpo = null;
    }

    if (response.ok) {
      const resendId = cuerpo && typeof cuerpo.id === "string" ? cuerpo.id : null;
      return { ok: true, resendId };
    }
    const nombreError = cuerpo && typeof cuerpo.name === "string" ? cuerpo.name : null;
    const mensajeError = cuerpo && typeof cuerpo.message === "string" ? cuerpo.message : `HTTP ${response.status}`;
    return { ok: false, status: response.status, name: nombreError, message: mensajeError };
  } catch (err) {
    // Sin respuesta HTTP: excepción de red, timeout (AbortError), DNS...
    // Es EXACTAMENTE el caso ambiguo (¿llegó a procesarlo Resend o no?) que
    // justifica la Idempotency-Key de arriba.
    const mensaje = err instanceof Error ? err.message : "excepcion_desconocida";
    return { ok: false, status: null, name: null, message: mensaje };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Construye asunto+HTML para un tipo de correo dado, incluyendo los
 * botones firmados de 'propuesta'. Extraído de enviarCorreoParaReserva para
 * que /reintentar-fallidos pueda reconstruir el mismo contenido (recalculado
 * con los datos VIGENTES de la reserva, no los del intento original — ver
 * comentario sobre tipoDeEmailSigueVigente en reintentos.ts).
 *
 * `tokenBasadoEnIso` — BUG PRE-EXISTENTE ENCONTRADO Y CORREGIDO AQUÍ (punto 3
 * del encargo): antes, `firmarToken` se llamaba SIEMPRE con su valor por
 * defecto (`Date.now()` en el momento de la llamada), así que `exp` — y por
 * tanto el token entero, y por tanto el HTML — cambiaba entre el intento
 * original y cada reintento de la MISMA fila. Si el original SÍ había
 * llegado a Resend, el reintento mandaba un cuerpo distinto con la MISMA
 * clave de idempotencia (claveIdempotenciaEnvio(envioId), estable por fila
 * — ver cabecera de intentarEnviarYRegistrar) → Resend respondía 409
 * `invalid_idempotent_request` (payload distinto, misma clave) →
 * clasificarErrorEnvio lo marca PERMANENTE → fallido_definitivo + aviso
 * "llama al cliente" sobre una propuesta que en realidad SÍ se había
 * entregado. Ahora `firmarToken` recibe el `creado_at` de la propia fila de
 * envios_email_reserva (estable durante todo su ciclo de vida: el reintento
 * hace UPDATE de la misma fila, nunca INSERT de una nueva — ver
 * reclamarReintento) en vez de "ahora", así que el token —y el HTML
 * completo— es IDÉNTICO en el intento original y en cada reintento de esa
 * fila. Solo afecta a 'propuesta' (el único tipo con token); una fila NUEVA
 * (nueva propuesta tras una anterior ya concluida) sigue obteniendo un
 * `creado_at` — y por tanto un `exp` — nuevo y correcto. */
async function construirCorreoParaTipo(
  reserva: ReservaRow,
  tipo: TipoPlantilla,
  plantilla: FilaPlantilla,
  tokenBasadoEnIso?: string,
): Promise<{ asunto: string; html: string }> {
  let urlsBotones: { principal?: string; secundario?: string } | undefined;
  if (tipo === "propuesta") {
    const huella = calcularHuella(reserva.estado, reserva.hora, reserva.espacio_id);
    const basadoEnEpoch = tokenBasadoEnIso ? Math.floor(new Date(tokenBasadoEnIso).getTime() / 1000) : undefined;
    const tokenAceptar = await firmarToken(TOKEN_SECRET, reserva.id, "aceptar", huella, basadoEnEpoch);
    const tokenRechazar = await firmarToken(TOKEN_SECRET, reserva.id, "rechazar", huella, basadoEnEpoch);
    urlsBotones = {
      principal: `${PUBLIC_BASE_URL}/aceptar?token=${encodeURIComponent(tokenAceptar)}`,
      secundario: `${PUBLIC_BASE_URL}/rechazar?token=${encodeURIComponent(tokenRechazar)}`,
    };
  }
  const datos = await construirDatosReserva(reserva, urlsBotones);
  return renderPlantilla(plantilla, datos);
}

interface ResultadoIntentoEnvio {
  enviado: boolean;
  /** true si, tras ESTE intento, la fila ha quedado 'fallido_definitivo'
   * (permanente, o transitorio que agotó sus intentos). */
  agotado: boolean;
  motivo?: string;
}

/** Pieza compartida por el primer intento y cada reintento: llama a Resend
 * con la clave de idempotencia de `envioId` y persiste el resultado
 * (enviado / fallido con próximo reintento / fallido_definitivo). No hace
 * ningún I/O de más: quien llama ya dejó la fila en 'pendiente' (claim). */
async function intentarEnviarYRegistrar(
  envioId: string,
  destinatario: string,
  asunto: string,
  cuerpoHtml: string,
  intentosActuales: number,
): Promise<ResultadoIntentoEnvio> {
  const resultado = await enviarPorResendConIdempotencia(
    { from: RESEND_FROM_EMAIL, to: [destinatario], subject: asunto, html: cuerpoHtml },
    claveIdempotenciaEnvio(envioId),
  );

  if (resultado.ok) {
    await marcarEnviado(envioId, resultado.resendId);
    return { enviado: true, agotado: false };
  }

  const clasificacion = clasificarErrorEnvio({ status: resultado.status, name: resultado.name, message: resultado.message });
  const mensajeError = resultado.message || (resultado.status ? `HTTP ${resultado.status}` : "sin_respuesta_http");

  if (!clasificacion.reintentable || seHanAgotadoLosIntentos(intentosActuales, MAX_INTENTOS_POR_DEFECTO)) {
    await marcarFallidoDefinitivo(envioId, mensajeError);
    return { enviado: false, agotado: true, motivo: clasificacion.motivo };
  }

  const proximoReintentoEn = calcularProximoReintento(ahoraIso(), intentosActuales);
  await marcarFallidoReintentable(envioId, mensajeError, proximoReintentoEn);
  return { enviado: false, agotado: false, motivo: clasificacion.motivo };
}

function resumenPerdido(reserva: ReservaRow, tipo: TipoPlantilla, motivo: string): EnvioPerdido {
  return {
    reservaId: reserva.id,
    nombre: reserva.nombre,
    telefono: reserva.telefono,
    email: reserva.email,
    fecha: reserva.fecha,
    hora: reserva.hora,
    tipoEmail: tipo,
    motivo,
  };
}

/**
 * Aviso interno cuando uno o más correos se dan por perdidos definitivamente
 * (punto 3 del encargo). Reutiliza notificaciones_dashboard (la campana que
 * ya existe, CentroNotificaciones.tsx + useNotificacionesDashboard.ts) — no
 * se inventa ningún mecanismo nuevo. SIEMPRE se agrupa en UN aviso por
 * llamada (construirAvisoLote, reintentos.ts), nunca uno por reserva, y
 * además se respeta un cooldown entre avisos (debeCrearAvisoLote): si Resend
 * cae diez minutos y arrastra a varias reservas, el resultado es un aviso
 * (o dos, si el cron pasa dos veces durante la caída), no doscientos — es
 * justo el escenario que el encargo pide evitar explícitamente.
 *
 * La comprobación del cooldown (SELECT del último aviso) y el INSERT no son
 * atómicos — mismo trade-off ya asumido en comprobarLimitePrueba más abajo
 * en este fichero: una carrera muy ajustada podría colar un aviso de más,
 * nunca menos de lo razonable, y esto no es una cuota de facturación.
 */
async function avisarEnviosDefinitivamentePerdidos(perdidos: EnvioPerdido[]): Promise<boolean> {
  const aviso = construirAvisoLote(perdidos);
  if (!aviso) return false;

  // MARGEN ANTI-ALUVIÓN COMPARTIDO ENTRE TUBERÍAS — BUG ENCONTRADO Y
  // CORREGIDO AQUÍ (verificado en la prueba de QA: un fallo de "solicitud
  // recibida" tapó 30 minutos el aviso de una "propuesta"/"confirmación" de
  // OTRA reserva). Un lote puede mezclar prioridades (p.ej. un recordatorio
  // Y una propuesta fallando en la misma pasada del cron); si CUALQUIERA de
  // las filas es 'alta', el aviso agrupado entero se trata como 'alta' — no
  // tiene sentido que una urgencia real quede en el carril 'normal' solo
  // porque venía acompañada. Ver prioridadEmailFallido/ORIGEN_EMAILS_RESERVA
  // (reintentos.ts) para el porqué completo de los dos ejes (origen Y
  // prioridad).
  const prioridad: PrioridadAvisoEmailFallido = perdidos.some(
    (p) => prioridadEmailFallido(p.tipoEmail, p.motivo) === "alta",
  )
    ? "alta"
    : "normal";

  const ahora = ahoraIso();
  const { data: ultimo, error: errUltimo } = await supabase
    .from("notificaciones_dashboard")
    .select("created_at")
    .eq("tipo", "email_fallido")
    .eq("origen", ORIGEN_EMAILS_RESERVA)
    .eq("prioridad", prioridad)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (errUltimo) {
    console.error("[emails-reserva] Error comprobando el ultimo aviso de email_fallido (se avisa igualmente):", errUltimo.message);
  } else if (!debeCrearAvisoLote((ultimo?.created_at as string | undefined) ?? null, ahora)) {
    console.log(
      `[emails-reserva] Aviso de correos perdidos omitido por cooldown (${perdidos.length} fila(s) afectada(s) en esta pasada, prioridad=${prioridad}, ya hay un aviso reciente del mismo origen y prioridad).`,
    );
    return false;
  }

  const referenciaUnica = perdidos.length === 1 ? perdidos[0] : null;
  const { error: errInsert } = await supabase.from("notificaciones_dashboard").insert({
    tipo: "email_fallido",
    origen: ORIGEN_EMAILS_RESERVA,
    prioridad,
    titulo: aviso.titulo,
    mensaje: aviso.mensaje,
    referencia_id: referenciaUnica?.reservaId ?? null,
    referencia_tipo: referenciaUnica ? "reserva" : null,
  });
  if (errInsert) {
    console.error("[emails-reserva] Error creando aviso de correos perdidos:", errInsert.message);
    return false;
  }
  return true;
}

interface ResultadoEnvio {
  enviado: boolean;
  motivo?: string;
}

/**
 * `tipoForzado` — BUG PRE-EXISTENTE ENCONTRADO Y CORREGIDO AQUÍ (no estaba
 * en el encargo original, pero está dentro de mi territorio y socava
 * directamente la robustez del recordatorio, que el propio informe de
 * capacidad señala como el caso más grave a arreglar): sin este parámetro,
 * el tipo de correo SIEMPRE se derivaba de `tipoEmailParaEstado(reserva.estado)`
 * — y ese switch NUNCA devuelve 'recordatorio' (no hay ningún `estado` de
 * `reservas` que se traduzca a eso; el recordatorio lo dispara el cron de
 * T-2 días sobre reservas que YA están 'confirmada', no una transición de
 * estado). Como resultado, handleRecordatorios llamaba a esta función y
 * acababa reclamando tipo_email='confirmada' — la MISMA fila que ya existe
 * 'enviado' desde que la reserva se confirmó — y chocaba siempre con
 * uq_envio_email_reserva_activo (23505), así que reclamarEnvio devolvía
 * null y NUNCA se llegaba a llamar a Resend: el recordatorio no fallaba de
 * forma visible, simplemente no se intentaba nunca, con
 * motivo="ya_enviado_o_en_curso" (que ni siquiera es un 'fallido' — no deja
 * ninguna fila para que /reintentar-fallidos pudiera encontrar). Que
 * `yaEnviadas` en handleRecordatorios ya consultara
 * `tipo_email='recordatorio'` específicamente confirma que ESE era el
 * diseño pretendido; solo faltaba pasarlo. Ahora handleRecordatorios pasa
 * `tipoForzado: 'recordatorio'` explícitamente en vez de dejar que se
 * derive del estado.
 */
async function enviarCorreoParaReserva(reservaId: string, tipoForzado?: TipoPlantilla): Promise<ResultadoEnvio> {
  const reserva = await fetchReserva(reservaId);
  if (!reserva) return { enviado: false, motivo: "reserva_no_encontrada" };
  if (!reserva.email) return { enviado: false, motivo: "reserva_sin_email" };

  const tipo = tipoForzado ?? tipoEmailParaEstado(reserva.estado);
  if (!tipo) return { enviado: false, motivo: `sin_plantilla_para_estado_${reserva.estado}` };

  const plantilla = await obtenerPlantillaActual(tipo);
  if (!plantilla) return { enviado: false, motivo: `plantilla_no_configurada_${tipo}` };

  // ORDEN CAMBIADO A PROPÓSITO (punto 3 del encargo): se reclama la fila
  // ANTES de construir el correo, no después — al revés de como estaba.
  // Así se conoce `claim.creado_at` (estable durante todo el ciclo de vida
  // de esta fila) ANTES de firmar el token de 'propuesta', y
  // construirCorreoParaTipo puede usarlo en vez de "ahora" (ver su
  // docstring para el bug completo que esto corrige). Es además el MISMO
  // orden que ya usaba el camino de reintento (procesarReintentoDeFila:
  // reclama -> lee reserva -> construye correo) — esto solo lo hace
  // consistente entre el primer intento y los reintentos.
  const claim = await reclamarEnvio(reserva.id, tipo, reserva.email, plantilla.id);
  if (!claim) return { enviado: false, motivo: "ya_enviado_o_en_curso" };

  if (!RESEND_API_KEY) {
    // No es un fallo transitorio: sin API key no hay forma de que un
    // reintento cambie nada. Directo a fallido_definitivo + aviso (con
    // mensaje distinto: aquí no sirve "llama al cliente", sirve "revisa la
    // configuración" — ver esProblemaDeConfiguracion en reintentos.ts).
    await marcarFallidoDefinitivo(claim.id, "resend_no_configurado");
    await avisarEnviosDefinitivamentePerdidos([resumenPerdido(reserva, tipo, "resend_no_configurado")]);
    return { enviado: false, motivo: "resend_no_configurado" };
  }

  // NUEVO (punto 1 del encargo): no intentar siquiera un envío a una
  // dirección que resend-webhook ya marcó como rebotada/quejada/suprimida.
  // Se comprueba aquí (tras reclamar, antes de construir el HTML) para no
  // malgastar la construcción del correo —con su token firmado— en un
  // envío que no va a intentarse.
  if (await estaDireccionSuprimida(reserva.email)) {
    await marcarFallidoDefinitivo(claim.id, "destinatario_suprimido");
    await avisarEnviosDefinitivamentePerdidos([resumenPerdido(reserva, tipo, "destinatario_suprimido")]);
    return { enviado: false, motivo: "destinatario_suprimido" };
  }

  const { asunto, html: cuerpoHtml } = await construirCorreoParaTipo(reserva, tipo, plantilla, claim.creado_at);

  const resultado = await intentarEnviarYRegistrar(claim.id, reserva.email, asunto, cuerpoHtml, 1);
  if (resultado.enviado) return { enviado: true };
  if (resultado.agotado) {
    await avisarEnviosDefinitivamentePerdidos([resumenPerdido(reserva, tipo, resultado.motivo ?? "error_desconocido")]);
    return { enviado: false, motivo: "fallido_definitivo" };
  }
  return { enviado: false, motivo: "fallido_reintentable" };
}

// ------------------------------------------------------------
// REINTENTO DE ENVÍOS FALLIDOS (cron, vía pg_net — ver migración
// 20260922160000_reintentos_emails_reserva.sql)
// ------------------------------------------------------------
interface FilaEnvioFallido {
  id: string;
  reserva_id: string;
  tipo_email: string;
  plantilla_id: string | null;
  intentos: number;
  resultado: string;
  proximo_reintento_en: string | null;
  /** Estable durante todo el ciclo de vida de la fila (el reintento hace
   * UPDATE, nunca INSERT) — se pasa a construirCorreoParaTipo para que el
   * token de 'propuesta' sea idéntico en cada reintento (punto 3 del
   * encargo, ver docstring de construirCorreoParaTipo). */
  creado_at: string;
}

async function obtenerFilasFallidasCandidatas(maxFilas: number): Promise<FilaEnvioFallido[]> {
  // Filtro grueso en SQL (resultado/intentos) por eficiencia; el filtro fino
  // (¿ya le toca por tiempo?) es esReintentableAhora (reintentos.ts), que se
  // aplica abajo antes de reclamar cada fila — igual que handleDetectarAusencias:
  // SQL acota, TS decide. Deliberadamente NO se filtra proximo_reintento_en
  // en SQL con un `.or(...)` (valor null O <= ahora): PostgREST soporta esa
  // sintaxis, pero es más frágil de construir a mano como texto (columnas y
  // valores separados por comas/puntos) que vale la pena aquí sin poder
  // probarlo contra un PostgREST real desde esta sesión (sin acceso a
  // Supabase). Se ordena por proximo_reintento_en (nulls primero, que son
  // los fallos recién marcados) para que las filas que ya tocan salgan
  // primero dentro del límite, y esReintentableAhora descarta en TS las que
  // el orden haya dejado dentro del límite sin tocarles aún.
  const { data, error } = await supabase
    .from("envios_email_reserva")
    .select("id, reserva_id, tipo_email, plantilla_id, intentos, resultado, proximo_reintento_en, creado_at")
    .eq("resultado", "fallido")
    .lt("intentos", MAX_INTENTOS_POR_DEFECTO)
    .order("proximo_reintento_en", { ascending: true, nullsFirst: true })
    .limit(maxFilas);
  if (error) {
    console.error("[emails-reserva] Error consultando envios fallidos candidatos a reintento:", error.message);
    return [];
  }
  return (data ?? []) as FilaEnvioFallido[];
}

/** Reclama una fila 'fallido' para reintentarla: UPDATE condicional
 * (resultado='fallido' AND intentos=<lo que se leyó>) que la pasa a
 * 'pendiente' e incrementa `intentos` en la misma operación atómica. Si
 * otra ejecución ya la reclamó (o ya cambió de estado) entre la consulta y
 * este UPDATE, la condición no casa con ninguna fila y se devuelve null —
 * mismo patrón de "UPDATE condicional + comprobar si afectó algo" que ya
 * usan handleAceptar/handleRechazarEjecutar en este mismo fichero, en vez de
 * una función de base de datos nueva para esto. */
async function reclamarReintento(fila: FilaEnvioFallido, ahoraIso_: string): Promise<{ id: string; intentos: number } | null> {
  const nuevosIntentos = fila.intentos + 1;
  const { data, error } = await supabase
    .from("envios_email_reserva")
    .update({ resultado: "pendiente", intentos: nuevosIntentos, ultimo_intento_at: ahoraIso_ })
    .eq("id", fila.id)
    .eq("resultado", "fallido")
    .eq("intentos", fila.intentos)
    .select("id, intentos")
    .maybeSingle();
  if (error) {
    console.error(`[emails-reserva] Error reclamando reintento de envio ${fila.id}:`, error.message);
    return null;
  }
  if (!data) return null;
  return { id: data.id as string, intentos: data.intentos as number };
}

type ResultadoProcesarReintento =
  | { estado: "enviado" }
  | { estado: "fallido" }
  | { estado: "definitivo"; perdido: EnvioPerdido | null }
  | { estado: "obsoleto" }
  | { estado: "omitido" };

async function procesarReintentoDeFila(fila: FilaEnvioFallido, ahoraIso_: string): Promise<ResultadoProcesarReintento> {
  const claim = await reclamarReintento(fila, ahoraIso_);
  if (!claim) return { estado: "omitido" };

  const reserva = await fetchReserva(fila.reserva_id);
  if (!reserva) {
    // No debería ocurrir (envios_email_reserva.reserva_id tiene ON DELETE
    // CASCADE: si la reserva se borra, esta fila se borra con ella), pero se
    // trata defensivamente sin generar aviso — no hay nada sobre lo que
    // llamar al cliente.
    await marcarFallidoDefinitivo(claim.id, "reserva_no_encontrada");
    return { estado: "definitivo", perdido: null };
  }

  const tipoActual = tipoEmailParaEstado(reserva.estado);
  if (!tipoDeEmailSigueVigente(fila.tipo_email, reserva.estado, tipoActual)) {
    // La reserva avanzó a otro estado mientras este correo seguía fallido:
    // reintentarlo mandaría contenido obsoleto (p.ej. una 'propuesta' de una
    // reserva ya cancelada). Se abandona SIN aviso: no es un fallo de
    // entrega, y el estado nuevo ya tiene (o tendrá) su propio correo a
    // través del flujo normal de enviarCorreoParaReserva.
    await marcarFallidoDefinitivo(claim.id, "estado_reserva_cambio_email_obsoleto");
    return { estado: "obsoleto" };
  }

  if (!reserva.email) {
    await marcarFallidoDefinitivo(claim.id, "reserva_sin_email");
    return { estado: "definitivo", perdido: resumenPerdido(reserva, fila.tipo_email as TipoPlantilla, "reserva_sin_email") };
  }

  // NUEVO (punto 1 del encargo): mismo motivo que en enviarCorreoParaReserva
  // — no reintentar hacia una dirección que resend-webhook ya marcó
  // rebotada/quejada/suprimida mientras esta fila esperaba su reintento.
  if (await estaDireccionSuprimida(reserva.email)) {
    await marcarFallidoDefinitivo(claim.id, "destinatario_suprimido");
    return { estado: "definitivo", perdido: resumenPerdido(reserva, fila.tipo_email as TipoPlantilla, "destinatario_suprimido") };
  }

  if (!fila.plantilla_id) {
    await marcarFallidoDefinitivo(claim.id, "plantilla_no_encontrada");
    return { estado: "definitivo", perdido: resumenPerdido(reserva, fila.tipo_email as TipoPlantilla, "plantilla_no_encontrada") };
  }

  // Se usa la MISMA plantilla_id que el intento original (no "la plantilla
  // actual" del tipo): si alguien edita la plantilla desde el panel entre
  // medias, el cliente recibe el contenido que de verdad se le prometió, no
  // uno distinto que ni siquiera vio nadie en el momento del fallo.
  const { data: plantillaData, error: errPlantilla } = await supabase
    .from("plantillas_email_reserva")
    .select("*")
    .eq("id", fila.plantilla_id)
    .maybeSingle();
  if (errPlantilla || !plantillaData) {
    await marcarFallidoDefinitivo(claim.id, "plantilla_no_encontrada");
    return { estado: "definitivo", perdido: resumenPerdido(reserva, fila.tipo_email as TipoPlantilla, "plantilla_no_encontrada") };
  }

  const { asunto, html: cuerpoHtml } = await construirCorreoParaTipo(
    reserva,
    fila.tipo_email as TipoPlantilla,
    plantillaData as FilaPlantilla,
    fila.creado_at,
  );

  const resultado = await intentarEnviarYRegistrar(claim.id, reserva.email, asunto, cuerpoHtml, claim.intentos);
  if (resultado.enviado) return { estado: "enviado" };
  if (resultado.agotado) {
    return {
      estado: "definitivo",
      perdido: resumenPerdido(reserva, fila.tipo_email as TipoPlantilla, resultado.motivo ?? "error_desconocido"),
    };
  }
  return { estado: "fallido" };
}

interface ResultadoReintentos {
  evaluadas: number;
  reintentados: number;
  enviados: number;
  fallidos_de_nuevo: number;
  definitivamente_perdidos: number;
  omitidos_estado_cambiado: number;
  aviso_creado: boolean;
}

async function reintentarEnviosFallidos(maxFilas: number): Promise<ResultadoReintentos> {
  // Libera cualquier 'pendiente' abandonado (de este mecanismo o de un envío
  // directo que murió a media ejecución) ANTES de buscar candidatas: una
  // fila así vuelve a 'fallido' y puede quedar elegible en esta misma pasada
  // si ya no tiene por qué esperar más (ver el comentario sobre esto en
  // reintentos.ts: no se le exige un backoff extra tras un abandono).
  await liberarPendientesAbandonados({});

  const ahora = ahoraIso();
  const candidatas = await obtenerFilasFallidasCandidatas(maxFilas);
  const elegibles = candidatas.filter((f) =>
    esReintentableAhora({ resultado: f.resultado, intentos: f.intentos, proximo_reintento_en: f.proximo_reintento_en }, ahora),
  );

  let enviados = 0;
  let fallidosDeNuevo = 0;
  let definitivamentePerdidos = 0;
  let omitidosEstadoCambiado = 0;
  const perdidos: EnvioPerdido[] = [];

  // Mismo patrón de lotes + pausa que handleRecordatorios (resend-lote.ts):
  // un reintento masivo tampoco debe saturar el límite de 10 req/s de Resend.
  const lotes = enLotes(elegibles, TAMANO_LOTE);
  for (let i = 0; i < lotes.length; i++) {
    const resultados = await Promise.allSettled(lotes[i].map((fila) => procesarReintentoDeFila(fila, ahora)));
    for (const r of resultados) {
      if (r.status !== "fulfilled") {
        console.error("[emails-reserva] Excepcion procesando reintento:", r.reason);
        fallidosDeNuevo++;
        continue;
      }
      const res = r.value;
      if (res.estado === "enviado") enviados++;
      else if (res.estado === "fallido") fallidosDeNuevo++;
      else if (res.estado === "obsoleto") omitidosEstadoCambiado++;
      else if (res.estado === "definitivo") {
        definitivamentePerdidos++;
        if (res.perdido) perdidos.push(res.perdido);
      }
      // "omitido" (no se pudo reclamar, otra ejecución ganó la carrera): no
      // cuenta en ningún contador propio, es ruido esperado de concurrencia.
    }
    if (i < lotes.length - 1) await esperar(PAUSA_LOTE_MS);
  }

  const avisoCreado = perdidos.length > 0 ? await avisarEnviosDefinitivamentePerdidos(perdidos) : false;

  return {
    evaluadas: candidatas.length,
    reintentados: elegibles.length,
    enviados,
    fallidos_de_nuevo: fallidosDeNuevo,
    definitivamente_perdidos: definitivamentePerdidos,
    omitidos_estado_cambiado: omitidosEstadoCambiado,
    aviso_creado: avisoCreado,
  };
}

// ------------------------------------------------------------
// PÁGINAS HTML (enlaces de aceptar/rechazar)
// ------------------------------------------------------------
function pageEnlaceInvalido(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Enlace no válido - Casa Tomás</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0;padding:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:linear-gradient(135deg,#f5f5f5,#e0e0e0);display:flex;align-items:center;justify-content:center;min-height:100vh; }
  .card { background:#fff;border-radius:10px;box-shadow:0 8px 20px rgba(0,0,0,.08);max-width:480px;width:100%;padding:32px 28px;text-align:center;border-top:6px solid #9B948E; }
  .icon { width:60px;height:60px;border-radius:50%;background:#F0EDEA;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:30px;color:#6B6560; }
  h1 { margin:12px 0 8px;font-size:22px;color:#333; }
  p { margin:6px 0;color:#555;line-height:1.6;font-size:14px; }
</style></head>
<body>
  <div class="card">
    <div class="icon">i</div>
    <h1>Este enlace ya no es válido</h1>
    <p>Puede que ya se haya usado, que haya caducado o que la reserva haya cambiado.</p>
    <p>Si necesitas ayuda, llámanos al <a href="tel:${RESTAURANTE_TEL_HREF}">${RESTAURANTE_TEL_TEXTO}</a>.</p>
  </div>
</body></html>`;
}

function pageAceptada(nombre: string, fecha: string, hora: string, comensales: number, espacio: string | null): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Reserva confirmada - Casa Tomás</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0;padding:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#f5f5f5,#e8efe4);display:flex;align-items:center;justify-content:center;min-height:100vh; }
  .card { background:#fff;border-radius:10px;box-shadow:0 8px 20px rgba(0,0,0,.08);max-width:480px;width:100%;padding:32px 28px;text-align:center; }
  .check { width:60px;height:60px;border-radius:50%;border:3px solid #2c7a33;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px;color:#2c7a33; }
  h1 { margin:12px 0 8px;font-size:24px;color:#333; }
  p { margin:6px 0;color:#555;line-height:1.5;font-size:14px; }
  .details { margin-top:18px;padding:14px 16px;background:#f7faf7;border-radius:8px;text-align:left;font-size:14px;color:#333; }
  .details b { color:#2c7a33; }
</style></head>
<body>
  <div class="card">
    <div class="check">&#10003;</div>
    <h1>¡Reserva confirmada!</h1>
    <p>Gracias, <b>${escapeHtml(nombre)}</b>. Hemos confirmado tu reserva en Casa Tomás con estos datos:</p>
    <div class="details">
      <p><b>Fecha:</b> ${escapeHtml(fecha)}</p>
      <p><b>Hora:</b> ${escapeHtml(hora.slice(0, 5))}</p>
      <p><b>Comensales:</b> ${comensales}</p>
      ${espacio ? `<p><b>Espacio:</b> ${escapeHtml(espacio)}</p>` : ""}
    </div>
    <p>¡Te esperamos!</p>
  </div>
</body></html>`;
}

function pageRechazarPreview(nombre: string, fecha: string, hora: string, comensales: number, ejecutarUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Rechazar propuesta - Casa Tomás</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0;padding:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:linear-gradient(135deg,#f5f5f5,#e0e0e0);display:flex;align-items:center;justify-content:center;min-height:100vh; }
  .card { background:#fff;border-radius:10px;box-shadow:0 8px 20px rgba(0,0,0,.08);max-width:480px;width:100%;padding:32px 28px;text-align:center;border-top:6px solid #e04f5f; }
  .icon { width:60px;height:60px;border-radius:50%;background:#fff5f5;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px;color:#e04f5f;font-weight:bold; }
  h1 { margin:12px 0 8px;font-size:24px;color:#333; }
  p { margin:6px 0;color:#555;line-height:1.5;font-size:14px; }
  .details { margin-top:20px;padding:16px;background:#f9f9f9;border-left:4px solid #e04f5f;border-radius:4px;text-align:left;font-size:14px;color:#333; }
  .btns { margin-top:30px;display:flex;flex-direction:column;gap:10px; }
  .btn-delete { display:block;width:100%;padding:14px 0;background:#e04f5f;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;font-size:16px;box-sizing:border-box; }
  .btn-keep { display:block;width:100%;padding:14px 0;background:transparent;color:#777;text-decoration:none;border-radius:4px;font-size:14px;border:1px solid #ddd;box-sizing:border-box; }
</style></head>
<body>
  <div class="card">
    <div class="icon">!</div>
    <h1>¿No puedes venir a estas condiciones?</h1>
    <p>Vas a rechazar la propuesta de reserva de <b>${escapeHtml(nombre)}</b> en Casa Tomás. La reserva quedará cancelada.</p>
    <div class="details">
      <p><b>Fecha:</b> ${escapeHtml(fecha)}</p>
      <p><b>Hora:</b> ${escapeHtml(hora.slice(0, 5))}</p>
      <p><b>Comensales:</b> ${comensales}</p>
    </div>
    <div class="btns">
      <a href="${ejecutarUrl}" class="btn-delete">Sí, cancelar la reserva</a>
      <a href="javascript:window.close()" class="btn-keep">No, esperar</a>
    </div>
    <p>Si tienes dudas, llámanos al ${RESTAURANTE_TEL_TEXTO}.</p>
  </div>
</body></html>`;
}

function pageRechazada(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Reserva cancelada - Casa Tomás</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0;padding:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:linear-gradient(135deg,#f5f5f5,#e0e0e0);display:flex;align-items:center;justify-content:center;min-height:100vh; }
  .card { background:#fff;border-radius:10px;box-shadow:0 8px 20px rgba(0,0,0,.08);max-width:480px;width:100%;padding:40px 28px;text-align:center;border-top:6px solid #394247; }
  .icon { width:70px;height:70px;border-radius:50%;border:3px solid #394247;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:36px;color:#394247;font-weight:bold; }
  h1 { margin:12px 0 15px;font-size:26px;color:#333; }
  p { margin:10px 0;color:#555;line-height:1.6;font-size:16px; }
</style></head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h1>Reserva cancelada</h1>
    <p>La reserva ha quedado cancelada. Gracias por avisarnos.</p>
    <p>Esperamos verte en otra ocasión en Casa Tomás.</p>
  </div>
</body></html>`;
}

function pageYaRechazada(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Reserva ya cancelada - Casa Tomás</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0;padding:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:linear-gradient(135deg,#f5f5f5,#e0e0e0);display:flex;align-items:center;justify-content:center;min-height:100vh; }
  .card { background:#fff;border-radius:10px;box-shadow:0 8px 20px rgba(0,0,0,.08);max-width:480px;width:100%;padding:32px 28px;text-align:center;border-top:6px solid #394247; }
  h1 { margin:12px 0 8px;font-size:22px;color:#333; }
  p { margin:6px 0;color:#555;line-height:1.6;font-size:14px; }
</style></head>
<body>
  <div class="card">
    <h1>Esta reserva ya estaba cancelada</h1>
    <p>No hace falta que hagas nada más.</p>
  </div>
</body></html>`;
}

// ------------------------------------------------------------
// ACCIÓN: notificar (llamada interna, disparada por notify-reservation-change)
// ------------------------------------------------------------
async function handleNotificar(req: Request): Promise<Response> {
  if (!comprobarSecretoCompartido(req)) return json({ ok: false, error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const reservaId = typeof body?.reserva_id === "string" ? body.reserva_id : null;
  if (!reservaId) return json({ ok: false, error: "reserva_id_requerido" }, 400);

  const resultado = await enviarCorreoParaReserva(reservaId);
  return json({ ok: resultado.enviado, motivo: resultado.motivo });
}

// ------------------------------------------------------------
// ACCIÓN: enviar-prueba (la llama el panel, sesión de usuario real — ver
// cabecera del fichero para por qué esta ruta no usa x-webhook-secret)
// ------------------------------------------------------------
// Discriminante por STRING literal ("ok"/"error"), no por booleano
// ({ok:true}|{ok:false,...}) — con strictNullChecks:false (tsconfig.json de
// este repo) TS no estrecha bien una unión discriminada por booleano
// literal, aunque no debería afectar a esta función Deno (fuera del
// `include` de tsconfig.app.json). Ver memoria del proyecto
// (codebase/tsconfig-narrowing-gotcha): el string literal narrowa bien en
// cualquier caso, así que se usa aquí directamente en vez de arriesgarse.
interface AutenticacionPanelOk {
  status: "ok";
  userId: string;
  userEmail: string;
}
interface AutenticacionPanelFallo {
  status: "error";
  response: Response;
}

/**
 * Usuario real (no la anon key suelta) + permiso de sección — mismo patrón
 * que procesar-factura/index.ts:autenticar, adaptado a la comprobación que
 * pide el contrato de este endpoint (can_write_section('reservas'), igual
 * que fn_restaurar_version_plantilla). Se llama con el propio cliente
 * `supabaseUser` (scoped a la cabecera Authorization de la petición) en vez
 * de con la service role + _user_id explícito: can_write_section() no acepta
 * _user_id, resuelve auth.uid() del JWT de la llamada — igual que cuando el
 * PANEL la invoca directamente (useRestaurarVersionPlantilla en
 * usePlantillasEmail.ts), solo que aquí la invoca el edge function de parte
 * del usuario.
 */
async function autenticarUsuarioPanel(req: Request): Promise<AutenticacionPanelOk | AutenticacionPanelFallo> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    console.error("[emails-reserva] enviar-prueba: sin cabecera Authorization");
    return { status: "error", response: json({ ok: false, error: "no_autorizado" }, 401) };
  }

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user || !user.email) {
    // Aquí cae la anon key suelta: es un JWT válido pero sin usuario detrás
    // (mismo comentario que procesar-factura/index.ts:autenticar).
    console.error("[emails-reserva] enviar-prueba: token sin usuario:", userError?.message);
    return { status: "error", response: json({ ok: false, error: "no_autorizado" }, 401) };
  }

  const { data: permitido, error: permError } = await supabaseUser.rpc("can_write_section", { _section: "reservas" });
  if (permError) {
    console.error("[emails-reserva] enviar-prueba: error comprobando permiso:", permError.message);
    return { status: "error", response: json({ ok: false, error: "error_permisos" }, 500) };
  }
  if (!permitido) {
    console.error("[emails-reserva] enviar-prueba: usuario sin permiso sobre reservas:", user.id);
    return { status: "error", response: json({ ok: false, error: "no_autorizado" }, 403) };
  }

  return { status: "ok", userId: user.id, userEmail: user.email };
}

const PRUEBA_LIMITE_ENVIOS = 5;
const PRUEBA_VENTANA_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Tope laxo, no una cuota exacta: usa la tabla genérica `rate_limit_log`
 * (id/identifier/created_at, ya aplicada, sin ningún uso hasta ahora — no
 * hace falta migración nueva para esto). Un conteo + insert no son atómicos,
 * así que una carrera muy ajustada puede colar algún envío de más; es
 * aceptable para "que nadie pueda pulsarlo cien veces seguidas" (punto 5 del
 * encargo), no para una cuota de facturación. Si falla la lectura (tabla no
 * disponible, etc.) se deja pasar en vez de tumbar el botón por una tabla de
 * métricas — a diferencia de comprobarSecretoCompartido, que falla cerrado a
 * propósito porque protege algo más sensible.
 */
async function comprobarLimitePrueba(userId: string): Promise<boolean> {
  const identificador = `emails-reserva:enviar-prueba:${userId}`;
  const desde = new Date(Date.now() - PRUEBA_VENTANA_MS).toISOString();

  const { count, error } = await supabase
    .from("rate_limit_log")
    .select("id", { count: "exact", head: true })
    .eq("identifier", identificador)
    .gte("created_at", desde);

  if (error) {
    console.error("[emails-reserva] enviar-prueba: error leyendo rate_limit_log (se deja pasar):", error.message);
    return true;
  }
  if (superaLimiteDePrueba(count ?? 0, PRUEBA_LIMITE_ENVIOS)) return false;

  const { error: errInsert } = await supabase.from("rate_limit_log").insert({ identifier: identificador });
  if (errInsert) {
    console.error("[emails-reserva] enviar-prueba: error registrando rate_limit_log:", errInsert.message);
  }
  return true;
}

async function handleEnviarPrueba(req: Request): Promise<Response> {
  const auth = await autenticarUsuarioPanel(req);
  if (auth.status === "error") return auth.response;

  const dentroDelLimite = await comprobarLimitePrueba(auth.userId);
  if (!dentroDelLimite) {
    return json(
      {
        ok: false,
        error: "rate_limited",
        message: "Has mandado varias pruebas seguidas. Espera unos minutos antes de volver a intentarlo.",
      },
      429,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  // `destinatario` llega en el body por contrato (usePlantillasEmail.ts) pero
  // NUNCA se lee para decidir a quién se manda — hacerlo convertiría esto en
  // un relé de correo abierto (punto 3 del encargo). El destino sale siempre
  // de `auth.userEmail`, resuelto arriba a partir del JWT.
  const tipo = body?.tipo;
  if (typeof tipo !== "string" || !TIPOS_PLANTILLA.includes(tipo as TipoPlantilla)) {
    return json({ ok: false, error: "plantilla_invalida", message: "Tipo de plantilla no reconocido" }, 400);
  }

  const campos = validarPlantillaBorrador(body?.plantilla);
  if (!campos) {
    return json(
      { ok: false, error: "plantilla_invalida", message: "Faltan campos obligatorios (asunto, saludo o cuerpo) en el borrador" },
      400,
    );
  }

  // version:0 no es una versión real — este borrador puede no estar
  // guardado todavía (es justo el caso de uso: probar antes de guardar) — y
  // renderPlantilla nunca lee `.version` (plantillas.ts), solo la usa quien
  // gestiona el historial de versiones.
  const plantilla: FilaPlantilla = { tipo: tipo as TipoPlantilla, version: 0, ...campos };
  const datos = datosEjemploParaTipo(tipo as TipoPlantilla, hoyEnMadridIso());

  // Botones con href de relleno: no hay ninguna reserva real detrás de una
  // prueba, así que aquí NUNCA se firma un token de aceptar/rechazar
  // (tokens.ts) — un enlace funcional de verdad no debe poder salir de un
  // envío de prueba. Solo interesa que el botón SE VEA si la plantilla lo
  // trae, para que la prueba se parezca a un correo real (punto 2).
  if (plantilla.texto_boton_principal) datos.botonPrincipalUrl = "#";
  if (plantilla.texto_boton_secundario) datos.botonSecundarioUrl = "#";

  // Mismo motor que un correo real (punto 1 del encargo): renderPlantilla es
  // la única función que construye el HTML, aquí y en enviarCorreoParaReserva.
  const { asunto, html: cuerpoHtml } = renderPlantilla(plantilla, datos);

  if (!RESEND_API_KEY) {
    return json({ ok: false, error: "resend_no_configurado" }, 200);
  }

  try {
    // to: [auth.userEmail] — nunca body.destinatario (ver comentario arriba).
    const { error } = await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to: [auth.userEmail],
      subject: asunto,
      html: cuerpoHtml,
    });

    if (error) {
      if (esErrorSandboxResend(error)) {
        console.error("[emails-reserva] enviar-prueba: restricción de sandbox de Resend:", error.message);
        return json(
          {
            ok: false,
            error: "resend_sandbox_restriction",
            message:
              "Tu cuenta de Resend está en modo prueba y solo entrega correos a la dirección verificada del dueño de la cuenta. Verifica un dominio en resend.com/domains para poder mandar pruebas a cualquier correo.",
          },
          200,
        );
      }
      console.error("[emails-reserva] enviar-prueba: error de Resend:", error.message ?? error);
      return json(
        { ok: false, error: "resend_error", message: error.message || "Error al enviar el correo de prueba" },
        200,
      );
    }

    return json({ ok: true });
  } catch (err) {
    console.error("[emails-reserva] enviar-prueba: excepción enviando:", (err as Error)?.message);
    return json({ ok: false, error: "excepcion", message: (err as Error)?.message ?? "Error inesperado" }, 200);
  }
}

// ------------------------------------------------------------
// ACCIÓN: aceptar la contraoferta (1 uso)
// ------------------------------------------------------------
async function handleAceptar(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") || "";
  const payload = await verificarToken(TOKEN_SECRET, token, "aceptar");
  if (!payload) return html(pageEnlaceInvalido());

  const reserva = await fetchReserva(payload.id);
  if (!reserva) return html(pageEnlaceInvalido());

  const huellaActual = calcularHuella(reserva.estado, reserva.hora, reserva.espacio_id);
  if (reserva.estado !== "verificada" || huellaActual !== payload.fp) {
    return html(pageEnlaceInvalido());
  }

  const { data: actualizada, error } = await supabase
    .from("reservas")
    .update({ estado: "confirmada" })
    .eq("id", reserva.id)
    .eq("estado", "verificada")
    .select("id")
    .maybeSingle();
  if (error || !actualizada) {
    console.error("[emails-reserva] No se pudo aceptar (condicion de carrera o error):", error?.message);
    return html(pageEnlaceInvalido());
  }

  // Correo de confirmación, best-effort: la reserva YA quedó confirmada
  // aunque este envío falle, así que no se condiciona la página de éxito a él.
  try {
    await enviarCorreoParaReserva(reserva.id);
  } catch (err) {
    console.error("[emails-reserva] Error mandando confirmacion tras aceptar:", err);
  }

  const mapa = await obtenerMapaEspacios();
  const espacioNombre = reserva.espacio_id ? mapa.get(reserva.espacio_id) ?? null : null;
  return html(pageAceptada(reserva.nombre || "", reserva.fecha, reserva.hora, reserva.numero_comensales, espacioNombre));
}

// ------------------------------------------------------------
// ACCIÓN: rechazar — paso 1, pantalla "¿seguro?", NO muta nada
// ------------------------------------------------------------
// Dos pasos a propósito, igual que reservas-web/cancelar: los clientes de
// correo pre-cargan enlaces al escanear el mensaje; un solo paso cancelaría
// reservas que nadie pulsó de verdad.
async function handleRechazarPreview(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") || "";
  const payload = await verificarToken(TOKEN_SECRET, token, "rechazar");
  if (!payload) return html(pageEnlaceInvalido());

  const reserva = await fetchReserva(payload.id);
  if (!reserva) return html(pageEnlaceInvalido());

  // Chequeo de "ya cancelada" ANTES de comprobar la huella: si se
  // comprobara después, una reserva ya cancelada (huella con
  // estado=cancelada) nunca pasaría el chequeo de huella y el cliente vería
  // "enlace no válido" en vez del mensaje correcto. Ver
  // docs/REVISION-PUERTOS-N8N.md X-2, mismo fallo en reservas-web/cancelar.
  if (reserva.estado === "cancelada") return html(pageYaRechazada());

  const huellaActual = calcularHuella(reserva.estado, reserva.hora, reserva.espacio_id);
  if (reserva.estado !== "verificada" || huellaActual !== payload.fp) return html(pageEnlaceInvalido());

  const ejecutarUrl = `${PUBLIC_BASE_URL}/rechazar/ejecutar?token=${encodeURIComponent(token)}`;
  return html(pageRechazarPreview(reserva.nombre || "", reserva.fecha, reserva.hora, reserva.numero_comensales, ejecutarUrl));
}

// ------------------------------------------------------------
// ACCIÓN: rechazar — paso 2, ejecuta el rechazo
// ------------------------------------------------------------
async function handleRechazarEjecutar(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") || "";
  const payload = await verificarToken(TOKEN_SECRET, token, "rechazar");
  if (!payload) return html(pageEnlaceInvalido());

  const reserva = await fetchReserva(payload.id);
  if (!reserva) return html(pageEnlaceInvalido());
  if (reserva.estado === "cancelada") return html(pageYaRechazada());

  const huellaActual = calcularHuella(reserva.estado, reserva.hora, reserva.espacio_id);
  if (reserva.estado !== "verificada" || huellaActual !== payload.fp) return html(pageEnlaceInvalido());

  const { data: actualizada, error } = await supabase
    .from("reservas")
    .update({ estado: "cancelada" })
    .eq("id", reserva.id)
    .eq("estado", "verificada")
    .select("id")
    .maybeSingle();
  if (error || !actualizada) {
    console.error("[emails-reserva] No se pudo rechazar (condicion de carrera o error):", error?.message);
    return html(pageEnlaceInvalido());
  }

  try {
    await enviarCorreoParaReserva(reserva.id);
  } catch (err) {
    console.error("[emails-reserva] Error mandando aviso de rechazo:", err);
  }

  return html(pageRechazada());
}

// ------------------------------------------------------------
// PROPUESTA DESDE UNA SOLICITUD DEL BOT (ver propuesta-solicitud.ts)
// ------------------------------------------------------------
function pageMensaje(opciones: {
  titulo: string;
  parrafos: string[];
  detalles?: Array<[string, string]>;
  boton?: { texto: string; url: string };
  color?: string;
}): string {
  const color = opciones.color ?? "#394247";
  const detalles = opciones.detalles?.length
    ? `<div class="details">${opciones.detalles
        .map(([k, v]) => `<p><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</p>`)
        .join("")}</div>`
    : "";
  const boton = opciones.boton
    ? `<a class="btn" href="${escapeHtml(opciones.boton.url)}">${escapeHtml(opciones.boton.texto)}</a>`
    : "";
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${escapeHtml(opciones.titulo)} - Casa Tomás</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<style>
  body { margin:0;padding:16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:linear-gradient(135deg,#f5f5f5,#e0e0e0);display:flex;align-items:center;justify-content:center;min-height:100vh;box-sizing:border-box; }
  .card { background:#fff;border-radius:10px;box-shadow:0 8px 20px rgba(0,0,0,.08);max-width:480px;width:100%;padding:32px 28px;text-align:center;border-top:6px solid ${color}; }
  h1 { margin:12px 0 8px;font-size:22px;color:#333; }
  p { margin:6px 0;color:#555;line-height:1.6;font-size:15px; }
  .details { margin-top:18px;padding:14px 16px;background:#f7f7f7;border-radius:8px;text-align:left;font-size:14px;color:#333; }
  .btn { display:block;margin-top:24px;padding:14px 0;background:${color};color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;font-size:16px; }
  a { color:${color}; }
</style></head>
<body>
  <div class="card">
    <h1>${escapeHtml(opciones.titulo)}</h1>
    ${opciones.parrafos.map((p) => `<p>${p}</p>`).join("")}
    ${detalles}
    ${boton}
  </div>
</body></html>`;
}

const TEXTO_LLAMANOS = `Si necesitas ayuda, llámanos al <a href="tel:${RESTAURANTE_TEL_HREF}">${RESTAURANTE_TEL_TEXTO}</a>.`;

async function fetchSolicitud(id: string): Promise<SolicitudParaPropuesta | null> {
  // select("*"): si la migración no está aplicada, las columnas de propuesta
  // simplemente no vienen (validarSolicitudParaEnvio lo detecta).
  const { data, error } = await supabase.from("solicitudes_pendientes").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as SolicitudParaPropuesta;
}

async function detallesPropuesta(s: SolicitudParaPropuesta): Promise<Array<[string, string]>> {
  const mapa = await obtenerMapaEspacios();
  const filas: Array<[string, string]> = [
    ["Fecha", formatearFechaLarga(s.fecha_solicitada)],
    ["Hora", horaCorta(s.hora_solicitada) ?? ""],
    ["Comensales", String(s.numero_comensales ?? "")],
  ];
  const sala = s.espacio_propuesto_id ? mapa.get(s.espacio_propuesto_id) : null;
  if (sala) filas.push(["Espacio", sala]);
  return filas;
}

function formatearFechaLarga(fecha: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha ?? "");
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : "";
}

/** La propuesta del enlace sigue siendo la vigente (mismos datos, mismo envío). */
function propuestaVigente(s: SolicitudParaPropuesta, huellaToken: string): boolean {
  return s.propuesta_estado === "enviada" && huellaPropuestaSolicitud(s) === huellaToken;
}

async function avisoPanelBestEffort(titulo: string, mensaje: string, solicitudId: string): Promise<void> {
  const { error } = await supabase.from("notificaciones_dashboard").insert({
    tipo: "propuesta_fallida",
    titulo,
    mensaje,
    referencia_id: solicitudId,
    referencia_tipo: "solicitud",
    prioridad: "alta",
  });
  if (error) console.error("[emails-reserva] No se pudo crear el aviso del panel:", error.message);
}

async function handleEnviarPropuestaSolicitud(req: Request): Promise<Response> {
  const auth = await autenticarUsuarioPanel(req);
  if (auth.status === "error") return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const solicitudId = typeof body?.solicitud_id === "string" ? body.solicitud_id : null;
  if (!solicitudId) return json({ ok: false, error: "solicitud_id_requerido" }, 400);

  const s = await fetchSolicitud(solicitudId);
  if (!s) return json({ ok: false, error: "no_encontrada", message: "No se encontró la solicitud." }, 404);

  const errorValidacion = validarSolicitudParaEnvio(s, hoyEnMadridIso());
  if (errorValidacion) {
    return json({ ok: false, error: errorValidacion, message: MENSAJE_ERROR_ENVIO[errorValidacion] });
  }
  if (!TOKEN_SECRET) {
    return json({ ok: false, error: "token_no_configurado", message: "Falta el secreto EMAILS_RESERVA_TOKEN_SECRET en la función." });
  }
  if (!RESEND_API_KEY) {
    return json({ ok: false, error: "resend_no_configurado", message: "Falta RESEND_API_KEY en la función." });
  }
  const email = (s.email ?? "").trim();
  if (await estaDireccionSuprimida(email)) {
    return json({
      ok: false,
      error: "destinatario_suprimido",
      message: "Esta dirección ya rebotó o marcó un correo como spam. Llama al cliente.",
    });
  }
  const plantilla = await obtenerPlantillaActual("propuesta");
  if (!plantilla) {
    return json({ ok: false, error: "plantilla_no_configurada", message: "No hay plantilla de propuesta configurada." });
  }

  const enviadaIso = ahoraIso();
  const epoch = epochSegundos(enviadaIso) as number;
  const huella = huellaPropuestaSolicitud({ ...s, propuesta_enviada_at: enviadaIso });
  const tokenAceptar = await firmarToken(TOKEN_SECRET, s.id, "aceptar_solicitud", huella, epoch);
  const tokenRechazar = await firmarToken(TOKEN_SECRET, s.id, "rechazar_solicitud", huella, epoch);

  const mapa = await obtenerMapaEspacios();
  const nombreEspacio = s.espacio_propuesto_id ? mapa.get(s.espacio_propuesto_id) ?? null : null;
  const datos = datosCorreoPropuestaSolicitud(s, nombreEspacio, {
    aceptar: `${PUBLIC_BASE_URL}/propuesta/aceptar?token=${encodeURIComponent(tokenAceptar)}`,
    rechazar: `${PUBLIC_BASE_URL}/propuesta/rechazar?token=${encodeURIComponent(tokenRechazar)}`,
  });
  const { asunto, html: cuerpoHtml } = renderPlantilla(plantilla, datos);

  // Primero se envía y DESPUÉS se registra: si el envío falla, la solicitud
  // no cambia (sigue en su estado anterior). El enlace solo funciona cuando
  // el UPDATE de abajo guarda el mismo `enviadaIso` que firma la huella.
  const resultado = await enviarPorResendConIdempotencia(
    { from: RESEND_FROM_EMAIL, to: [email], subject: asunto, html: cuerpoHtml },
    claveIdempotenciaPropuestaSolicitud(s.id, epoch),
  );
  if (!resultado.ok) {
    console.error(`[emails-reserva] Propuesta de solicitud ${s.id} no enviada:`, resultado.status, resultado.message);
    return json({
      ok: false,
      error: "envio_fallido",
      message: `No se pudo enviar el correo${resultado.message ? `: ${resultado.message}` : ""}. Inténtalo de nuevo.`,
    });
  }

  const { data: actualizada, error: errUpdate } = await supabase
    .from("solicitudes_pendientes")
    .update({
      propuesta_estado: "enviada",
      propuesta_enviada_at: enviadaIso,
      propuesta_error: null,
      estado: s.estado === "pendiente" ? "contactado" : s.estado,
      updated_at: enviadaIso,
    })
    .eq("id", s.id)
    .neq("propuesta_estado", "aceptada")
    .select("id")
    .maybeSingle();
  if (errUpdate || !actualizada) {
    console.error(`[emails-reserva] Propuesta ${s.id} enviada pero no registrada:`, errUpdate?.message);
    return json({
      ok: false,
      error: "registro_fallido",
      message: "El correo salió pero no se pudo registrar en la solicitud, así que su enlace no funcionará. Vuelve a enviarla.",
    });
  }

  return json({ ok: true, enviada_at: enviadaIso, destinatario: email });
}

async function leerSolicitudDeToken(
  req: Request,
  accion: "aceptar_solicitud" | "rechazar_solicitud",
): Promise<{ token: string; fp: string; s: SolicitudParaPropuesta } | null> {
  const token = new URL(req.url).searchParams.get("token") || "";
  const payload = await verificarToken(TOKEN_SECRET, token, accion);
  if (!payload) return null;
  const s = await fetchSolicitud(payload.id);
  if (!s) return null;
  return { token, fp: payload.fp, s };
}

async function handlePropuestaAceptarPreview(req: Request): Promise<Response> {
  const leido = await leerSolicitudDeToken(req, "aceptar_solicitud");
  if (!leido) return html(pageEnlaceInvalido());
  const { s, fp, token } = leido;
  if (s.propuesta_estado === "aceptada") {
    return html(pageMensaje({ titulo: "Tu reserva ya está confirmada", parrafos: ["No hace falta que hagas nada más. ¡Te esperamos!"], color: "#2c7a33" }));
  }
  if (!propuestaVigente(s, fp)) return html(pageEnlaceInvalido());
  return html(
    pageMensaje({
      titulo: "Confirma tu reserva",
      parrafos: [`Hola, <b>${escapeHtml(s.nombre || "")}</b>. Esta es la propuesta de Casa Tomás:`],
      detalles: await detallesPropuesta(s),
      boton: { texto: "Sí, confirmo la reserva", url: `${PUBLIC_BASE_URL}/propuesta/aceptar/ejecutar?token=${encodeURIComponent(token)}` },
      color: "#2c7a33",
    }),
  );
}

async function handlePropuestaAceptarEjecutar(req: Request): Promise<Response> {
  const leido = await leerSolicitudDeToken(req, "aceptar_solicitud");
  if (!leido) return html(pageEnlaceInvalido());
  const { s, fp } = leido;
  if (s.propuesta_estado !== "aceptada" && !propuestaVigente(s, fp)) return html(pageEnlaceInvalido());

  const detalles = await detallesPropuesta(s);
  const { data, error } = await supabase.rpc("fn_aceptar_propuesta_solicitud", { p_solicitud_id: s.id, p_via: "email" });
  if (error) {
    console.error(`[emails-reserva] fn_aceptar_propuesta_solicitud(${s.id}) falló:`, error.message);
    await avisoPanelBestEffort(
      "Un cliente aceptó la propuesta pero falló el alta",
      `${s.nombre || "Cliente"} (${s.telefono || "sin teléfono"}) pulsó aceptar y no se pudo crear la reserva (${error.message}). Llámale.`,
      s.id,
    );
  }
  const res = (error ? null : data) as { ok?: boolean; error?: string; estado?: string; reserva_id?: string; ya_aceptada?: boolean } | null;
  const pagina = paginaTrasAceptar(res);

  // Correo de la reserva recién creada (confirmada -> 'confirmada';
  // pendiente por lista negra -> 'solicitud_recibida'). Best-effort: la
  // reserva ya existe aunque el correo falle (entra en los reintentos).
  if (res?.ok && res.reserva_id && !res.ya_aceptada) {
    try {
      await enviarCorreoParaReserva(res.reserva_id);
    } catch (err) {
      console.error("[emails-reserva] Error mandando correo tras aceptar propuesta de solicitud:", err);
    }
  }

  switch (pagina) {
    case "confirmada":
      return html(pageMensaje({ titulo: "¡Reserva confirmada!", parrafos: [`Gracias, <b>${escapeHtml(s.nombre || "")}</b>. Te esperamos en Casa Tomás.`], detalles, color: "#2c7a33" }));
    case "recibida":
      return html(pageMensaje({ titulo: "Hemos recibido tu respuesta", parrafos: ["El restaurante revisará la reserva y te la confirmará en breve.", TEXTO_LLAMANOS], detalles }));
    case "sin_aforo":
      return html(pageMensaje({
        titulo: "No hemos podido confirmar la reserva",
        parrafos: ["Lo sentimos: mientras respondías se ha completado el aforo de ese turno. El restaurante ya está avisado y te llamará para buscar otra opción.", TEXTO_LLAMANOS],
        detalles,
        color: "#b45309",
      }));
    case "fecha_pasada":
      return html(pageMensaje({ titulo: "Esta propuesta ha caducado", parrafos: ["El día propuesto ya ha pasado. El restaurante está avisado.", TEXTO_LLAMANOS], color: "#b45309" }));
    case "no_vigente":
      return html(pageEnlaceInvalido());
    default:
      if (!error) {
        await avisoPanelBestEffort(
          "Un cliente aceptó la propuesta pero no se creó la reserva",
          `${s.nombre || "Cliente"} (${s.telefono || "sin teléfono"}): ${res?.error ?? "error desconocido"}. Llámale.`,
          s.id,
        );
      }
      return html(pageMensaje({
        titulo: "No hemos podido confirmar la reserva",
        parrafos: ["Ha ocurrido un problema al registrar tu respuesta. El restaurante está avisado y te llamará.", TEXTO_LLAMANOS],
        color: "#b45309",
      }));
  }
}

async function handlePropuestaRechazarPreview(req: Request): Promise<Response> {
  const leido = await leerSolicitudDeToken(req, "rechazar_solicitud");
  if (!leido) return html(pageEnlaceInvalido());
  const { s, fp, token } = leido;
  if (s.propuesta_estado === "rechazada") {
    return html(pageMensaje({ titulo: "Ya nos lo habías dicho", parrafos: ["Tenemos registrado que no te viene bien esta propuesta. " + TEXTO_LLAMANOS] }));
  }
  if (!propuestaVigente(s, fp)) return html(pageEnlaceInvalido());
  return html(
    pageMensaje({
      titulo: "¿No te viene bien esta propuesta?",
      parrafos: ["Si la rechazas, no se creará la reserva. El restaurante verá tu respuesta."],
      detalles: await detallesPropuesta(s),
      boton: { texto: "Sí, rechazar la propuesta", url: `${PUBLIC_BASE_URL}/propuesta/rechazar/ejecutar?token=${encodeURIComponent(token)}` },
      color: "#e04f5f",
    }),
  );
}

async function handlePropuestaRechazarEjecutar(req: Request): Promise<Response> {
  const leido = await leerSolicitudDeToken(req, "rechazar_solicitud");
  if (!leido) return html(pageEnlaceInvalido());
  const { s, fp } = leido;
  if (s.propuesta_estado !== "rechazada" && !propuestaVigente(s, fp)) return html(pageEnlaceInvalido());

  const { data, error } = await supabase.rpc("fn_rechazar_propuesta_solicitud", { p_solicitud_id: s.id, p_via: "email" });
  const res = data as { ok?: boolean } | null;
  if (error || !res?.ok) {
    console.error(`[emails-reserva] fn_rechazar_propuesta_solicitud(${s.id}) falló:`, error?.message ?? JSON.stringify(data));
    return html(pageEnlaceInvalido());
  }
  return html(pageMensaje({ titulo: "Gracias por avisarnos", parrafos: ["Hemos registrado que no te viene bien la propuesta.", "Esperamos verte en otra ocasión en Casa Tomás."] }));
}

// ------------------------------------------------------------
// ACCIÓN: recordatorios T-2 (cron, vía pg_net — ver migración)
// ------------------------------------------------------------
async function handleRecordatorios(req: Request): Promise<Response> {
  if (!comprobarSecretoCompartido(req)) return json({ ok: false, error: "unauthorized" }, 401);

  await liberarPendientesAbandonados({ tipo_email: "recordatorio" });

  const hoy = hoyEnMadridIso();
  const fechaObjetivo = fechaObjetivoRecordatorio(hoy, 2);

  const { data: candidatas, error: errCand } = await supabase
    .from("reservas")
    .select("id, estado, fecha, email")
    .eq("fecha", fechaObjetivo)
    .eq("estado", "confirmada");
  if (errCand) {
    console.error("[emails-reserva] Error consultando candidatas a recordatorio:", errCand.message);
    return json({ ok: false, error: "error_consultando_reservas" }, 500);
  }

  const idsCandidatas = ((candidatas ?? []) as ReservaParaRecordatorio[]).map((r) => r.id);
  const yaEnviadas = new Set<string>();
  if (idsCandidatas.length > 0) {
    const { data: enviosPrevios } = await supabase
      .from("envios_email_reserva")
      .select("reserva_id")
      .eq("tipo_email", "recordatorio")
      .eq("resultado", "enviado")
      .in("reserva_id", idsCandidatas);
    for (const fila of (enviosPrevios ?? []) as Array<{ reserva_id: string }>) yaEnviadas.add(fila.reserva_id);
  }

  const seleccionadas = seleccionarReservasParaRecordatorio(
    (candidatas ?? []) as ReservaParaRecordatorio[],
    fechaObjetivo,
    yaEnviadas,
  );

  const lotes = enLotes(seleccionadas, TAMANO_LOTE);
  let enviados = 0;
  let fallidos = 0;
  for (let i = 0; i < lotes.length; i++) {
    // tipoForzado: "recordatorio" — ver el comentario extenso junto a
    // enviarCorreoParaReserva sobre el bug que esto corrige: sin forzarlo,
    // el tipo se derivaba del estado ('confirmada') y chocaba siempre con
    // el envío de confirmación ya existente, así que el recordatorio nunca
    // llegaba a intentarse de verdad.
    const resultados = await Promise.allSettled(lotes[i].map((r) => enviarCorreoParaReserva(r.id, "recordatorio")));
    for (const r of resultados) {
      if (r.status === "fulfilled" && r.value.enviado) enviados++;
      else fallidos++;
    }
    if (i < lotes.length - 1) await esperar(PAUSA_LOTE_MS);
  }

  return json({
    ok: true,
    fecha_objetivo: fechaObjetivo,
    candidatas: candidatas?.length ?? 0,
    seleccionadas: seleccionadas.length,
    enviados,
    fallidos,
  });
}

// ------------------------------------------------------------
// ACCIÓN: detectar ausencias sin avisar (cron, vía pg_net — ver migración)
// ------------------------------------------------------------
async function handleDetectarAusencias(req: Request): Promise<Response> {
  if (!comprobarSecretoCompartido(req)) return json({ ok: false, error: "unauthorized" }, 401);

  const ahora = ahoraIso();
  const hoy = hoyEnMadridIso();

  // Filtro grueso en SQL (confirmada, fecha <= hoy); el margen de gracia
  // fino lo decide esAusenciaSinAvisar en TS (es lo que se testea).
  const { data: candidatas, error } = await supabase
    .from("reservas")
    .select("id, estado, fecha, hora, telefono, email, nombre")
    .eq("estado", "confirmada")
    .lte("fecha", hoy);
  if (error) {
    console.error("[emails-reserva] Error consultando candidatas a ausencia:", error.message);
    return json({ ok: false, error: "error_consultando_reservas" }, 500);
  }

  let marcadas = 0;
  let sugeridas = 0;

  for (const reserva of (candidatas ?? []) as Array<{
    id: string;
    estado: string;
    fecha: string;
    hora: string;
    telefono: string | null;
    email: string | null;
    nombre: string | null;
  }>) {
    const instante = instanteMadridAFechaUtc(reserva.fecha, reserva.hora).toISOString();
    if (!esAusenciaSinAvisar(reserva.estado, instante, ahora)) continue;

    const { error: errUpdate } = await supabase
      .from("reservas")
      .update({ estado: "no_show" })
      .eq("id", reserva.id)
      .eq("estado", "confirmada");
    if (errUpdate) {
      console.error(`[emails-reserva] Error marcando no_show ${reserva.id}:`, errUpdate.message);
      continue;
    }
    marcadas++;

    // Sin teléfono no hay identificador con el que dar de alta un veto
    // (fn_aprobar_sugerencia_blacklist exige telefono o email; se prioriza
    // telefono, igual que el resto del dominio de reservas).
    if (!reserva.telefono && !reserva.email) continue;

    const { data: previas } = await supabase
      .from("reservas")
      .select("estado, fecha")
      .eq("telefono", reserva.telefono ?? "___sin_telefono___")
      .neq("id", reserva.id)
      .in("estado", ["no_show", "completada", "cancelada"]);

    const historial = resumirHistorialCliente((previas ?? []) as ReservaHistorialCliente[]);

    const { error: errSugerencia } = await supabase.from("sugerencias_blacklist").insert({
      reserva_id: reserva.id,
      telefono: reserva.telefono,
      email: reserva.email,
      nombre_cliente: reserva.nombre,
      motivo: "no_show",
      historial,
    });
    if (!errSugerencia) {
      sugeridas++;
    } else if (errSugerencia.code !== "23505") {
      // 23505 = uq_sugerencia_por_reserva, ya existía sugerencia para esta
      // reserva (reintento del cron) -> idempotente, no es un fallo real.
      console.error(`[emails-reserva] Error creando sugerencia de blacklist para ${reserva.id}:`, errSugerencia.message);
    }
  }

  return json({ ok: true, evaluadas: candidatas?.length ?? 0, marcadas_no_show: marcadas, sugerencias_creadas: sugeridas });
}

// ------------------------------------------------------------
// ACCIÓN: reintentar envíos fallidos (cron, vía pg_net — ver migración
// 20260922160000_reintentos_emails_reserva.sql)
// ------------------------------------------------------------
async function handleReintentarFallidos(req: Request): Promise<Response> {
  if (!comprobarSecretoCompartido(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const resultado = await reintentarEnviosFallidos(MAX_FILAS_REINTENTO);
  return json({ ok: true, ...resultado });
}

// ------------------------------------------------------------
// ROUTER
// ------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const idx = segments.indexOf("emails-reserva");
  const route = (idx === -1 ? segments : segments.slice(idx + 1)).join("/");

  try {
    if (req.method === "POST" && route === "notificar") return await handleNotificar(req);
    if (req.method === "POST" && route === "recordatorios") return await handleRecordatorios(req);
    if (req.method === "POST" && route === "detectar-ausencias") return await handleDetectarAusencias(req);
    if (req.method === "POST" && route === "reintentar-fallidos") return await handleReintentarFallidos(req);
    if (req.method === "POST" && route === "enviar-prueba") return await handleEnviarPrueba(req);
    if (req.method === "GET" && route === "aceptar") return await handleAceptar(req);
    if (req.method === "GET" && route === "rechazar") return await handleRechazarPreview(req);
    if (req.method === "GET" && route === "rechazar/ejecutar") return await handleRechazarEjecutar(req);
    if (req.method === "POST" && route === "enviar-propuesta-solicitud") return await handleEnviarPropuestaSolicitud(req);
    if (req.method === "GET" && route === "propuesta/aceptar") return await handlePropuestaAceptarPreview(req);
    if (req.method === "GET" && route === "propuesta/aceptar/ejecutar") return await handlePropuestaAceptarEjecutar(req);
    if (req.method === "GET" && route === "propuesta/rechazar") return await handlePropuestaRechazarPreview(req);
    if (req.method === "GET" && route === "propuesta/rechazar/ejecutar") return await handlePropuestaRechazarEjecutar(req);
    return json({ ok: false, error: "not_found", route }, 404);
  } catch (err) {
    console.error("[emails-reserva] Error no controlado:", (err as Error)?.message, (err as Error)?.stack);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
