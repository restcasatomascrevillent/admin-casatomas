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
//   ENLACES DE LOS CORREOS (2026-09-24, ver enlaces-web.ts): Supabase sirve
//   el HTML de *.supabase.co como text/plain, así que las páginas que ve el
//   cliente viven en las webs públicas
//   (https://<web del negocio>/reserva/respuesta?token=...) y llaman aquí:
//   POST /enlace/consultar {token} JSON -> estado + datos (NO muta)
//   POST /enlace/ejecutar  {token} JSON -> acepta/rechaza (clic del cliente)
//   GET  /aceptar, /rechazar, /rechazar/ejecutar,
//        /propuesta/aceptar[/ejecutar], /propuesta/rechazar[/ejecutar]
//        -> 302 a la web con el mismo token (correos ya enviados). NUNCA mutan.
//
//   PROPUESTA DESDE UNA SOLICITUD DEL BOT (2026-09-23, ver
//   propuesta-solicitud.ts y la migración 20260923210000):
//   POST /enviar-propuesta-solicitud  JSON -> la llama el panel (JWT de
//                                           usuario + can_write_section,
//                                           igual que /enviar-prueba); manda
//                                           la plantilla 'propuesta' con los
//                                           datos guardados en la solicitud
//   Sus enlaces van a la misma página de la web (/enlace/* de arriba); al
//   aceptar se llama a fn_aceptar_propuesta_solicitud (crea la reserva), al
//   rechazar a fn_rechazar_propuesta_solicitud. Todo en DOS pasos (ver
//   /enlace/*): un escáner de correo que precargue el enlace no crea nada.
//
//   AVISO DE «RESERVA MODIFICADA» (2026-09-30, ver reserva-modificada.ts y la
//   migración 20260930211000):
//   POST /notificar-modificacion  JSON -> la llama el panel al guardar una
//                                           edición con «Avisar al cliente
//                                           del cambio» marcada (JWT de
//                                           usuario + can_write_section,
//                                           igual que /enviar-prueba). Body:
//                                           { reserva_id, antes: { fecha,
//                                           hora, comensales } }. Responde
//                                           { ok, motivo? } como /notificar.
//   Va DIRECTA (no por notify-reservation-change) a propósito: si el panel
//   se publica antes que esta función, la ruta no existe (404) y el panel
//   dice «no se ha podido pedir»; por /notificar, una versión vieja habría
//   mandado el correo que tocara por ESTADO en vez del aviso de cambio.
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
//   WEB_CASA_TOMAS_URL          (web de los enlaces de Casa Tomás; por defecto
//                                https://restaurantecasatomascrevillente.es)
//   WEB_TOUZA_URL               (web de los enlaces de Touza; por defecto
//                                https://touza-restaurant-website.vercel.app)
//   EMAILS_RESERVA_ORIGENES_EXTRA (CORS extra de /enlace/*, separados por comas)
//   (EMAILS_RESERVA_PUBLIC_URL ya no se usa: los enlaces van a las webs)
//   EMAILS_RESERVA_LOTE_TAMANO, EMAILS_RESERVA_LOTE_PAUSA_MS  (ver resend-lote.ts)
// ============================================================================

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

import {
  renderPlantilla,
  negocioParaMarca,
  debeEnviarSolicitudRecibida,
  TIPOS_PLANTILLA,
  type TipoPlantilla,
  type FilaPlantilla,
  type DatosReservaParaCorreo,
  type DatosNegocio,
} from "./plantillas.ts";
import {
  seleccionarReservasParaRecordatorio,
  fechaObjetivoRecordatorio,
  enLotes,
  type ReservaParaRecordatorio,
} from "./recordatorios.ts";
import { esAusenciaSinAvisar, resumirHistorialCliente, type ReservaHistorialCliente } from "./ausencias.ts";
import { firmarToken, calcularHuella, type CargaToken } from "./tokens.ts";
import {
  basesWeb,
  origenesPermitidos,
  enlaceRespuestaWeb,
  cabecerasCorsEnlace,
  verificarTokenCualquierAccion,
  describirAccion,
  marcaSegura,
  negocioEnlace,
  respuestaInvalida,
  estadoContraoferta,
  estadoPropuesta,
  estadoTrasAceptarPropuesta,
  estadoErrorConfirmarContraoferta,
  tokenDelCuerpo,
  type AccionWeb,
  type EstadoEnlace,
  type DetallesEnlace,
  type RespuestaEnlace,
} from "./enlaces-web.ts";
import type { Marca } from "../reservas-web/plantillas.ts";
import {
  TAMANO_LOTE_POR_DEFECTO,
  PAUSA_ENTRE_LOTES_MS_POR_DEFECTO,
  leerEnteroEnv,
  filaEstaAbandonada,
  esperar,
} from "./resend-lote.ts";
import { instanteMadridAFechaUtc, hoyEnMadridIso, ahoraIso } from "./tiempo.ts";
// Doble opt-in del newsletter (migración 20261003184500): el clic del cliente
// que ACEPTA desde el correo marca reservas.email_verificado_at.
import { registrarEmailVerificado, type ClienteVerificacion } from "../_shared/verificacion-email.ts";
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
  huellaSolicitudCoincide,
  datosCorreoPropuestaSolicitud,
  marcaDeSolicitudParaCorreo,
  claveIdempotenciaPropuestaSolicitud,
  epochSegundos,
  horaCorta,
  MENSAJE_ERROR_ENVIO,
  type SolicitudParaPropuesta,
} from "./propuesta-solicitud.ts";
import {
  TIPO_RESERVA_MODIFICADA,
  leerDiaHoraComensales,
  modificacionReciente,
  motivoParaNoAvisar,
  planificarAviso,
  avisoSigueVigente,
  leerDetalleAviso,
  datosModificacionParaCorreo,
  valoresListaNegra,
  hayEntradaListaNegraVigente,
  type AvisoAnterior,
  type DetalleAviso,
} from "./reserva-modificada.ts";

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
// Webs públicas donde viven las páginas de los enlaces de los correos (ver
// enlaces-web.ts: Supabase sirve el HTML de *.supabase.co como text/plain).
const BASES_WEB = basesWeb({ casaTomas: Deno.env.get("WEB_CASA_TOMAS_URL"), touza: Deno.env.get("WEB_TOUZA_URL") });
const ORIGENES_WEB = origenesPermitidos(BASES_WEB, Deno.env.get("EMAILS_RESERVA_ORIGENES_EXTRA"));
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
  /** Negocio (columna NOT NULL DEFAULT 'casa_tomas', migración
   * 20260922180000): 'touza' = El Reservado. Decide la marca del correo. */
  marca?: string | null;
  /** 'web' | 'telefono' | 'manual'. Decide si el estado 'pendiente' manda
   * o no el correo de 'solicitud_recibida' — ver `tipoEmailParaEstado`. */
  canal?: string | null;
  /** Solo los mira el aviso de «reserva modificada»: datos de prueba
   * (`esReservaDePrueba`), cliente marcado en lista negra y que la reserva se
   * acabe de guardar (`modificacionReciente`: el trigger update_reservas_updated_at
   * mueve updated_at en cada UPDATE). */
  notas_cliente?: string | null;
  en_blacklist?: boolean | null;
  updated_at?: string | null;
}

async function fetchReserva(id: string): Promise<ReservaRow | null> {
  const { data, error } = await supabase
    .from("reservas")
    .select("id, nombre, telefono, email, fecha, hora, numero_comensales, estado, espacio_id, hora_solicitada, espacio_solicitado_id, marca, canal, notas_cliente, en_blacklist, updated_at")
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

/** Marca de una solicitud: la columna `marca` (20260930100000) si viene; si
 * no (migración sin aplicar), sala propuesta > marcador de El Reservado en
 * las notas > Casa Tomás. Ver marcaDeSolicitudParaCorreo. */
async function marcaDeSolicitud(s: SolicitudParaPropuesta): Promise<Marca> {
  let marcaEspacio: unknown = null;
  if (!s.marca && s.espacio_propuesto_id) {
    const { data } = await supabase
      .from("espacios_reserva")
      .select("caracteristicas")
      .eq("id", s.espacio_propuesto_id)
      .maybeSingle();
    marcaEspacio = (data as { caracteristicas?: { marca?: unknown } | null } | null)?.caracteristicas?.marca ?? null;
  }
  return marcaDeSolicitudParaCorreo(s, marcaEspacio);
}

async function negocioDeSolicitud(s: SolicitudParaPropuesta): Promise<DatosNegocio> {
  return negocioParaMarca(await marcaDeSolicitud(s));
}


/**
 * Tipo de correo que le toca a una reserva por su ESTADO. El `canal` solo
 * pinta en 'pendiente': desde 2026-09-28 una reserva de la WEB ya no recibe
 * 'solicitud_recibida' (decisión del dueño — la web ya le dice en pantalla
 * que se le contactará, y el primer y único correo que recibe es la
 * 'propuesta' con los botones). El resto de canales lo siguen recibiendo:
 * el porqué, entero, en `debeEnviarSolicitudRecibida` (plantillas.ts).
 *
 * Devolver null aquí es el camino correcto y ya existía ('completada' /
 * 'no_show'): `enviarCorreoParaReserva` para en seco (con motivo
 * "solicitud_recibida_silenciada_canal_web") ANTES de reclamar fila en
 * `envios_email_reserva`, así que no deja ni fila, ni reintento, ni aviso.
 *
 * NO afecta a /enviar-prueba: ese endpoint recibe el tipo del panel y
 * renderiza la plantilla directamente, sin pasar por aquí. El dueño puede
 * seguir previsualizando y probando la plantilla 'solicitud_recibida'.
 */
function tipoEmailParaEstado(estado: string, canal?: string | null): TipoPlantilla | null {
  switch (estado) {
    case "pendiente":
      return debeEnviarSolicitudRecibida(canal) ? "solicitud_recibida" : null;
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

/** La fila vigente, con su `id` (lo guarda envios_email_reserva.plantilla_id
 * para que un reintento use la MISMA versión). */
type FilaPlantillaGuardada = FilaPlantilla & { id: string };

async function obtenerPlantillaActual(tipo: TipoPlantilla): Promise<FilaPlantillaGuardada | null> {
  const { data, error } = await supabase
    .from("plantillas_email_reserva")
    .select("*")
    .eq("tipo", tipo)
    .eq("es_actual", true)
    .maybeSingle();
  if (error || !data) return null;
  return data as FilaPlantillaGuardada;
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
    negocio: negocioParaMarca(reserva.marca),
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
 * `creado_at` — y por tanto un `exp` — nuevo y correcto.
 *
 * 'reserva_modificada' (2026-09-30): `detalleAviso` es el `detalle` de su fila
 * (antes/ahora/estado, ver reserva-modificada.ts) — lo mismo en el primer
 * intento y en cada reintento, así que el correo sale idéntico. Si la reserva
 * está 'verificada' lleva los MISMOS botones que 'propuesta', firmados con la
 * huella actual y el `creado_at` de su propia fila: el enlace nuevo de
 * «Confirma tu reserva». */
async function construirCorreoParaTipo(
  reserva: ReservaRow,
  tipo: TipoPlantilla,
  plantilla: FilaPlantilla,
  tokenBasadoEnIso?: string,
  detalleAviso?: DetalleAviso | null,
): Promise<{ asunto: string; html: string }> {
  let urlsBotones: { principal?: string; secundario?: string } | undefined;
  if (tipo === "propuesta" || (tipo === TIPO_RESERVA_MODIFICADA && reserva.estado === "verificada")) {
    // Sin sala (reservas-sin-salas): asignarla después no rompe el enlace.
    const huella = calcularHuella(reserva.estado, reserva.hora);
    const basadoEnEpoch = tokenBasadoEnIso ? Math.floor(new Date(tokenBasadoEnIso).getTime() / 1000) : undefined;
    const tokenAceptar = await firmarToken(TOKEN_SECRET, reserva.id, "aceptar", huella, basadoEnEpoch);
    const tokenRechazar = await firmarToken(TOKEN_SECRET, reserva.id, "rechazar", huella, basadoEnEpoch);
    urlsBotones = {
      principal: enlaceRespuestaWeb(BASES_WEB, reserva.marca, tokenAceptar),
      secundario: enlaceRespuestaWeb(BASES_WEB, reserva.marca, tokenRechazar),
    };
  }
  const datos = await construirDatosReserva(reserva, urlsBotones);
  if (tipo === TIPO_RESERVA_MODIFICADA) {
    // La hora pedida AL CREAR la reserva no es «lo de antes» de este cambio:
    // sin esto saldría también un «Pediste / Te ofrecemos» que no toca.
    datos.horaSolicitada = null;
    datos.espacioSolicitado = null;
    datos.modificacion = detalleAviso ? datosModificacionParaCorreo(detalleAviso) : null;
  }
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

  const tipo = tipoForzado ?? tipoEmailParaEstado(reserva.estado, reserva.canal);
  if (!tipo) {
    // Se distingue el silencio DELIBERADO por canal (web + 'pendiente') del
    // "este estado no manda correo" de toda la vida ('completada',
    // 'no_show'). Los dos son un ok:false del que NADIE tiene que avisar,
    // pero en los logs de `notify-reservation-change` no son lo mismo y
    // conviene poder leer cuál de los dos fue.
    const motivo = reserva.estado === "pendiente"
      ? `solicitud_recibida_silenciada_canal_${reserva.canal ?? "desconocido"}`
      : `sin_plantilla_para_estado_${reserva.estado}`;
    return { enviado: false, motivo };
  }

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
// AVISO DE «RESERVA MODIFICADA» (panel -> POST /notificar-modificacion).
// Decisiones en reserva-modificada.ts; aquí solo el I/O. Del «reclamar» en
// adelante es EXACTAMENTE el camino de enviarCorreoParaReserva (Resend con
// Idempotency-Key por fila, supresión, fallido/fallido_definitivo + aviso).
// ------------------------------------------------------------

/**
 * ¿Cliente en lista negra? La marca de la reserva (ya la mira
 * motivoParaNoAvisar) o una entrada vigente de `blacklist` con su email o su
 * teléfono en cualquier formato — la misma consulta que hace el panel
 * (useVerificarBlacklist), repetida porque el servidor no se fía del
 * navegador. FALLA CERRADO (`null`): al revés que estaDireccionSuprimida, aquí
 * lo seguro es NO escribir; el panel lo dice y el personal llama.
 */
async function reservaEnListaNegra(reserva: ReservaRow): Promise<boolean | null> {
  const { emails, telefonos } = valoresListaNegra(reserva.email, reserva.telefono);
  const hoy = hoyEnMadridIso();
  const busquedas: Array<[string, string[]]> = [
    ["email", emails],
    ["telefono", telefonos],
  ];
  for (const [tipo, valores] of busquedas) {
    if (valores.length === 0) continue;
    const { data, error } = await supabase.from("blacklist").select("caduca_el").eq("tipo", tipo).in("valor", valores);
    if (error) {
      console.error("[emails-reserva] notificar-modificacion: error comprobando la lista negra (no se envía):", error.message);
      return null;
    }
    if (hayEntradaListaNegraVigente((data ?? []) as Array<{ caduca_el: string | null }>, hoy)) return true;
  }
  return false;
}

/** El aviso de modificación más reciente de la reserva que aún cuenta
 * (pendiente, enviado o fallido que se reintentará). `undefined` = no se pudo
 * leer: sin él no se puede garantizar que no se duplica, así que no se envía. */
async function ultimoAvisoModificacion(reservaId: string): Promise<AvisoAnterior | null | undefined> {
  const { data, error } = await supabase
    .from("envios_email_reserva")
    .select("id, resultado, detalle")
    .eq("reserva_id", reservaId)
    .eq("tipo_email", TIPO_RESERVA_MODIFICADA)
    .in("resultado", ["pendiente", "enviado", "fallido"])
    .order("creado_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[emails-reserva] Error leyendo el último aviso de modificación de ${reservaId}:`, error.message);
    return undefined;
  }
  return (data as AvisoAnterior | null) ?? null;
}

// Discriminante por STRING literal (no booleano) — mismo motivo que
// AutenticacionPanelOk/Fallo más abajo.
type ReclamoAvisoModificacion =
  | { status: "ok"; id: string; creado_at: string }
  | { status: "ocupado" }
  | { status: "error"; motivo: string };

/** Como reclamarEnvio, pero con `clave_aviso` y `detalle`, y distinguiendo
 * "ya hay un aviso igual" (23505 del índice único) de un error real — el panel
 * espera la respuesta y no debe decir «ya se le había enviado» por un fallo de
 * la BD (p. ej. la migración 20260930211000 sin aplicar). */
async function reclamarAvisoModificacion(
  reserva: ReservaRow,
  destinatario: string,
  plantillaId: string,
  clave: string,
  detalle: DetalleAviso,
): Promise<ReclamoAvisoModificacion> {
  const { data, error } = await supabase
    .from("envios_email_reserva")
    .insert({
      reserva_id: reserva.id,
      tipo_email: TIPO_RESERVA_MODIFICADA,
      destinatario,
      plantilla_id: plantillaId,
      resultado: "pendiente",
      clave_aviso: clave,
      detalle,
    })
    .select("id, creado_at")
    .single();
  if (error) {
    if (error.code === "23505") return { status: "ocupado" };
    console.error(`[emails-reserva] Error reclamando aviso de modificación (${reserva.id}):`, error.code, error.message);
    // 23514 = CHECK sin 'reserva_modificada'; 42703/PGRST204 = sin las columnas nuevas.
    const sinMigracion = error.code === "23514" || error.code === "42703" || error.code === "PGRST204";
    return { status: "error", motivo: sinMigracion ? "migracion_pendiente" : "error_registrando_envio" };
  }
  return { status: "ok", id: data.id as string, creado_at: data.creado_at as string };
}

async function enviarAvisoModificacion(reservaId: string, antesBruto: unknown): Promise<ResultadoEnvio> {
  // Lo de AHORA sale de la BD (la edición ya está guardada); del panel solo el «antes», validado.
  const antes = leerDiaHoraComensales(antesBruto);
  if (!antes) return { enviado: false, motivo: "antes_invalido" };

  const reserva = await fetchReserva(reservaId);
  if (!reserva) return { enviado: false, motivo: "reserva_no_encontrada" };

  // Primero lo que no necesita más consultas; la lista negra, solo si todo lo demás deja avisar.
  const motivo = motivoParaNoAvisar(reserva, antes, { ahoraIso: ahoraIso(), enListaNegra: false });
  if (motivo) return { enviado: false, motivo };
  // El «antes» viene del navegador: solo vale justo después de guardar la
  // edición (updated_at lo mueve el trigger en cada UPDATE). Ver modificacionReciente.
  if (!modificacionReciente(reserva.updated_at, ahoraIso())) return { enviado: false, motivo: "cambio_no_reciente" };
  const enListaNegra = await reservaEnListaNegra(reserva);
  if (enListaNegra === null) return { enviado: false, motivo: "error_comprobando_lista_negra" };
  if (enListaNegra) return { enviado: false, motivo: "en_lista_negra" };

  // 'verificada': el correo lleva el enlace NUEVO de «Confirma tu reserva» (el
  // viejo deja de valer si cambió la hora). Sin secreto para firmarlo no se
  // manda un aviso a medias: el panel lo dice y el personal llama.
  if (reserva.estado === "verificada" && !TOKEN_SECRET) return { enviado: false, motivo: "token_no_configurado" };

  const plantilla = await obtenerPlantillaActual(TIPO_RESERVA_MODIFICADA);
  if (!plantilla) return { enviado: false, motivo: `plantilla_no_configurada_${TIPO_RESERVA_MODIFICADA}` };

  // Mismo criterio que reclamarEnvio: un 'pendiente' abandonado (la función
  // murió a medias) vuelve a 'fallido' ANTES de mirar cuál es el último aviso.
  await liberarPendientesAbandonados({ reserva_id: reserva.id, tipo_email: TIPO_RESERVA_MODIFICADA });
  const anterior = await ultimoAvisoModificacion(reserva.id);
  if (anterior === undefined) return { enviado: false, motivo: "error_registrando_envio" };

  const plan = planificarAviso({ reserva, antes, anterior });
  if (plan.accion === "no_enviar") return { enviado: false, motivo: plan.motivo };

  const destinatario = (reserva.email ?? "").trim();
  const claim = await reclamarAvisoModificacion(reserva, destinatario, plantilla.id, plan.clave, plan.detalle);
  if (claim.status === "ocupado") return { enviado: false, motivo: "ya_enviado_o_en_curso" };
  if (claim.status === "error") return { enviado: false, motivo: claim.motivo };

  if (!RESEND_API_KEY) {
    await marcarFallidoDefinitivo(claim.id, "resend_no_configurado");
    await avisarEnviosDefinitivamentePerdidos([resumenPerdido(reserva, TIPO_RESERVA_MODIFICADA, "resend_no_configurado")]);
    return { enviado: false, motivo: "resend_no_configurado" };
  }

  if (await estaDireccionSuprimida(destinatario)) {
    await marcarFallidoDefinitivo(claim.id, "destinatario_suprimido");
    await avisarEnviosDefinitivamentePerdidos([resumenPerdido(reserva, TIPO_RESERVA_MODIFICADA, "destinatario_suprimido")]);
    return { enviado: false, motivo: "destinatario_suprimido" };
  }

  const { asunto, html: cuerpoHtml } = await construirCorreoParaTipo(
    reserva,
    TIPO_RESERVA_MODIFICADA,
    plantilla,
    claim.creado_at,
    plan.detalle,
  );

  const resultado = await intentarEnviarYRegistrar(claim.id, destinatario, asunto, cuerpoHtml, 1);
  if (resultado.enviado) return { enviado: true };
  if (resultado.agotado) {
    await avisarEnviosDefinitivamentePerdidos([
      resumenPerdido(reserva, TIPO_RESERVA_MODIFICADA, resultado.motivo ?? "error_desconocido"),
    ]);
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
  /** Solo 'reserva_modificada': antes/ahora/estado del aviso (migración
   * 20260930211000). `undefined` si la migración aún no está aplicada. */
  detalle?: unknown;
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
  // `*` en vez de la lista de columnas (2026-09-30): así llega `detalle`
  // (aviso de «reserva modificada») sin que esta consulta —la de TODOS los
  // reintentos— falle si la función se despliega antes que la migración
  // 20260930211000 que crea esa columna.
  const { data, error } = await supabase
    .from("envios_email_reserva")
    .select("*")
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
 * usan ejecutarContraoferta y los antiguos handleAceptar/handleRechazarEjecutar en este mismo fichero, en vez de
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

  // Con `canal`: una fila 'solicitud_recibida' antigua de una reserva WEB
  // que quedara 'fallido' da ahora tipoActual=null -> "obsoleto" -> se
  // abandona sin aviso, que es exactamente lo que se quiere (no reintentar
  // un correo que ya no se manda). Las de teléfono/manual siguen igual.
  const tipoActual = tipoEmailParaEstado(reserva.estado, reserva.canal);
  // 'reserva_modificada' no sale de un ESTADO (tipoEmailParaEstado nunca lo
  // devuelve): sigue vigente si la reserva conserva el estado y los datos con
  // los que se avisó y aún no ha pasado (avisoSigueVigente). Si volvió a
  // cambiar, el aviso nuevo ya lleva su propio correo: este se abandona.
  const detalleAviso = fila.tipo_email === TIPO_RESERVA_MODIFICADA ? leerDetalleAviso(fila.detalle) : null;
  const sigueVigente =
    fila.tipo_email === TIPO_RESERVA_MODIFICADA
      ? avisoSigueVigente(detalleAviso, reserva, ahoraIso_)
      : tipoDeEmailSigueVigente(fila.tipo_email, reserva.estado, tipoActual);
  if (!sigueVigente) {
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
    detalleAviso,
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
// ACCIÓN: notificar-modificacion (la llama el panel al guardar una edición
// con «Avisar al cliente del cambio» marcada). Sesión de usuario real, NO
// x-webhook-secret — mismo motivo que /enviar-prueba (ver cabecera). Responde
// { ok, motivo? } con status 200 para cualquier resultado de negocio (el panel
// ESPERA la respuesta para decirle al personal qué ha pasado de verdad).
// ------------------------------------------------------------

/** Tope por usuario (mismo patrón que /enviar-prueba, `rate_limit_log`): una
 * persona editando a mano no pide más de un aviso cada pocos segundos; 20 en
 * 5 minutos solo lo supera algo automatizado. Laxo a propósito (ver
 * comprobarLimite): si no se puede leer la tabla, deja pasar. */
const AVISO_MODIFICACION_LIMITE = 20;
const AVISO_MODIFICACION_VENTANA_MS = 5 * 60 * 1000;

async function handleNotificarModificacion(req: Request): Promise<Response> {
  const auth = await autenticarUsuarioPanel(req);
  if (auth.status === "error") return auth.response;
  const dentroDelLimite = await comprobarLimite(
    `emails-reserva:notificar-modificacion:${auth.userId}`,
    AVISO_MODIFICACION_LIMITE,
    AVISO_MODIFICACION_VENTANA_MS,
  );
  if (!dentroDelLimite) return json({ ok: false, motivo: "demasiados_avisos" });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const reservaId = typeof body?.reserva_id === "string" && body.reserva_id.trim() ? body.reserva_id.trim() : null;
  if (!reservaId) return json({ ok: false, error: "reserva_id_requerido" }, 400);

  const resultado = await enviarAvisoModificacion(reservaId, body?.antes);
  console.log(
    `[emails-reserva] notificar-modificacion ${reservaId} (usuario ${auth.userId}): ${resultado.enviado ? "enviado" : resultado.motivo}`,
  );
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
  return await comprobarLimite(`emails-reserva:enviar-prueba:${userId}`, PRUEBA_LIMITE_ENVIOS, PRUEBA_VENTANA_MS);
}

/** El mismo tope laxo de comprobarLimitePrueba (ver su comentario), para
 * cualquier identificador: cuenta en `rate_limit_log` y registra la llamada;
 * si no se puede leer, deja pasar. Lo usan /enviar-prueba y
 * /notificar-modificacion. */
async function comprobarLimite(identificador: string, limite: number, ventanaMs: number): Promise<boolean> {
  const desde = new Date(Date.now() - ventanaMs).toISOString();

  const { count, error } = await supabase
    .from("rate_limit_log")
    .select("id", { count: "exact", head: true })
    .eq("identifier", identificador)
    .gte("created_at", desde);

  if (error) {
    console.error(`[emails-reserva] ${identificador}: error leyendo rate_limit_log (se deja pasar):`, error.message);
    return true;
  }
  if (superaLimiteDePrueba(count ?? 0, limite)) return false;

  const { error: errInsert } = await supabase.from("rate_limit_log").insert({ identifier: identificador });
  if (errInsert) {
    console.error(`[emails-reserva] ${identificador}: error registrando rate_limit_log:`, errInsert.message);
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
// PROPUESTA DESDE UNA SOLICITUD DEL BOT (ver propuesta-solicitud.ts)
// ------------------------------------------------------------
async function fetchSolicitud(id: string): Promise<SolicitudParaPropuesta | null> {
  // select("*"): si la migración no está aplicada, las columnas de propuesta
  // simplemente no vienen (validarSolicitudParaEnvio lo detecta).
  const { data, error } = await supabase.from("solicitudes_pendientes").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as SolicitudParaPropuesta;
}

/** La propuesta del enlace sigue siendo la vigente (mismos datos, mismo envío).
 * La sala no cuenta; los enlaces de formato antiguo siguen valiendo (ver
 * huellaSolicitudCoincide). */
function propuestaVigente(s: SolicitudParaPropuesta, huellaToken: string): boolean {
  return s.propuesta_estado === "enviada" && huellaSolicitudCoincide(huellaToken, s);
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
  const marca = await marcaDeSolicitud(s);
  const datos: DatosReservaParaCorreo = {
    ...datosCorreoPropuestaSolicitud(s, nombreEspacio, {
      aceptar: enlaceRespuestaWeb(BASES_WEB, marca, tokenAceptar),
      rechazar: enlaceRespuestaWeb(BASES_WEB, marca, tokenRechazar),
    }),
    negocio: negocioParaMarca(marca),
  };
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

// ------------------------------------------------------------
// ENLACES DE LOS CORREOS (aceptar/rechazar) — API JSON para las webs
// ------------------------------------------------------------
// Las páginas que ve el cliente las sirven las webs públicas (ver cabecera de
// enlaces-web.ts: Supabase fuerza text/plain en el HTML de *.supabase.co).
// Aquí solo quedan:
//   POST /enlace/consultar  -> estado + datos (NO muta nada)
//   POST /enlace/ejecutar   -> ejecuta la acción (clic del cliente)
//   GET  rutas antiguas     -> 302 a la web del negocio con el mismo token
// La autenticación sigue siendo el token HMAC (tokens.ts): mismo secreto,
// mismas huellas, mismas acciones — un token de un correo ya enviado vale
// igual en la web nueva.

/** Nombre de la sala para la página del cliente: SOLO en Touza, donde el
 * espacio (El Reservado) es lo que se reserva. En Casa Tomás la sala es una
 * decisión interna y el cliente no la ve (reservas-sin-salas). */
async function espacioVisibleParaCliente(marca: Marca, espacioId: string | null | undefined): Promise<string | null> {
  if (marca !== "touza" || !espacioId) return null;
  const mapa = await obtenerMapaEspacios();
  return mapa.get(espacioId) ?? null;
}

/** Detalles para la web a partir de una solicitud (fecha ISO, hora HH:MM). */
async function detallesDeSolicitud(s: SolicitudParaPropuesta, marca: Marca): Promise<DetallesEnlace> {
  return {
    nombre: s.nombre || "",
    fecha: (s.fecha_solicitada ?? "").slice(0, 10),
    hora: horaCorta(s.hora_solicitada) ?? "",
    comensales: Number(s.numero_comensales) || 0,
    espacio: await espacioVisibleParaCliente(marca, s.espacio_propuesto_id),
  };
}

async function detallesDeReserva(r: ReservaRow): Promise<DetallesEnlace> {
  return {
    nombre: r.nombre || "",
    fecha: (r.fecha ?? "").slice(0, 10),
    hora: (r.hora ?? "").slice(0, 5),
    comensales: r.numero_comensales,
    espacio: await espacioVisibleParaCliente(marcaSegura(r.marca), r.espacio_id),
  };
}

/** Contexto común de un token ya verificado: la fila, su marca y su flujo. */
type ContextoEnlace =
  | { tipo: "contraoferta"; accion: AccionWeb; carga: CargaToken; reserva: ReservaRow; marca: Marca }
  | { tipo: "propuesta"; accion: AccionWeb; carga: CargaToken; solicitud: SolicitudParaPropuesta; marca: Marca };

async function cargarContextoEnlace(token: string): Promise<ContextoEnlace | null> {
  const carga = await verificarTokenCualquierAccion(TOKEN_SECRET, token);
  if (!carga) return null;
  const { tipo, accion } = describirAccion(carga.accion);
  if (tipo === "contraoferta") {
    const reserva = await fetchReserva(carga.id);
    if (!reserva) return null;
    return { tipo, accion, carga, reserva, marca: marcaSegura(reserva.marca) };
  }
  const solicitud = await fetchSolicitud(carga.id);
  if (!solicitud) return null;
  return { tipo, accion, carga, solicitud, marca: await marcaDeSolicitud(solicitud) };
}

function respuestaEnlace(
  ctx: ContextoEnlace,
  estado: EstadoEnlace,
  detalles: DetallesEnlace | null,
): RespuestaEnlace {
  const ok = estado === "pendiente" || estado === "hecho" || estado === "recibida" || estado === "ya_hecho";
  return {
    ok,
    estado,
    tipo: ctx.tipo,
    accion: ctx.accion,
    negocio: negocioEnlace(ctx.marca, BASES_WEB),
    // Un enlace inválido no enseña datos de nadie.
    detalles: estado === "invalido" ? null : detalles,
  };
}

async function consultarEnlace(token: string): Promise<RespuestaEnlace> {
  const ctx = await cargarContextoEnlace(token);
  if (!ctx) return respuestaInvalida(BASES_WEB);
  if (ctx.tipo === "contraoferta") {
    const estado = estadoContraoferta(ctx.accion, ctx.reserva, ctx.carga.fp);
    return respuestaEnlace(ctx, estado, await detallesDeReserva(ctx.reserva));
  }
  const estado = estadoPropuesta(ctx.accion, ctx.solicitud.propuesta_estado, propuestaVigente(ctx.solicitud, ctx.carga.fp));
  return respuestaEnlace(ctx, estado, await detallesDeSolicitud(ctx.solicitud, ctx.marca));
}

/** Contraoferta: aceptar = verificada -> confirmada; rechazar = verificada -> cancelada. */
async function ejecutarContraoferta(ctx: Extract<ContextoEnlace, { tipo: "contraoferta" }>): Promise<RespuestaEnlace> {
  const { reserva, accion } = ctx;
  const detalles = await detallesDeReserva(reserva);
  const previo = estadoContraoferta(accion, reserva, ctx.carga.fp);
  if (previo !== "pendiente") return respuestaEnlace(ctx, previo, detalles);

  const nuevoEstado = accion === "aceptar" ? "confirmada" : "cancelada";
  const { data: actualizada, error } = await supabase
    .from("reservas")
    .update({ estado: nuevoEstado })
    .eq("id", reserva.id)
    .eq("estado", "verificada")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error(`[emails-reserva] No se pudo ${accion} la contraoferta ${reserva.id}:`, error.code, error.message);
    const estado = estadoErrorConfirmarContraoferta(error.code, error.message);
    await avisoPanelReservaBestEffort(reserva, accion, error.message);
    return respuestaEnlace(ctx, estado, detalles);
  }
  if (!actualizada) {
    // Carrera: otra pestaña/otra persona cambió el estado entre medias.
    const actual = await fetchReserva(reserva.id);
    const estado = actual ? estadoContraoferta(accion, actual, ctx.carga.fp) : "invalido";
    return respuestaEnlace(ctx, estado === "pendiente" ? "error" : estado, detalles);
  }

  // Doble opt-in del newsletter: «Confirmo» desde el correo demuestra que el
  // cliente controla ese buzón (rechazar no: puede ser alguien diciendo «no
  // es mía»). Antes del correo de confirmación (ver _shared/verificacion-email.ts).
  // Nunca lanza: si falla, la reserva ya está confirmada y solo se pierde el alta.
  if (accion === "aceptar") {
    await registrarEmailVerificado(supabase as unknown as ClienteVerificacion, reserva.id, new Date().toISOString(), "emails-reserva");
  }

  // Correo de confirmación / aviso de rechazo, best-effort: el cambio de
  // estado ya está hecho aunque el envío falle (entra en los reintentos).
  try {
    await enviarCorreoParaReserva(reserva.id);
  } catch (err) {
    console.error(`[emails-reserva] Error mandando correo tras ${accion} contraoferta:`, err);
  }
  return respuestaEnlace(ctx, "hecho", detalles);
}

async function avisoPanelReservaBestEffort(reserva: ReservaRow, accion: AccionWeb, motivo: string): Promise<void> {
  const { error } = await supabase.from("notificaciones_dashboard").insert({
    tipo: "propuesta_fallida",
    titulo: accion === "aceptar" ? "Un cliente aceptó la propuesta pero no se pudo confirmar" : "Un cliente rechazó la propuesta pero no se pudo registrar",
    mensaje: `${reserva.nombre || "Cliente"} (${reserva.telefono || "sin teléfono"}), ${reserva.fecha} ${(reserva.hora || "").slice(0, 5)}: ${motivo}. Llámale.`,
    referencia_id: reserva.id,
    referencia_tipo: "reserva",
    prioridad: "alta",
  });
  if (error) console.error("[emails-reserva] No se pudo crear el aviso del panel:", error.message);
}

/** Propuesta de una solicitud del bot: aceptar crea la reserva; rechazar la marca rechazada. */
async function ejecutarPropuesta(ctx: Extract<ContextoEnlace, { tipo: "propuesta" }>): Promise<RespuestaEnlace> {
  const { solicitud: s, accion } = ctx;
  const detalles = await detallesDeSolicitud(s, ctx.marca);
  const previo = estadoPropuesta(accion, s.propuesta_estado, propuestaVigente(s, ctx.carga.fp));
  if (previo !== "pendiente") return respuestaEnlace(ctx, previo, detalles);

  if (accion === "rechazar") {
    const { data, error } = await supabase.rpc("fn_rechazar_propuesta_solicitud", { p_solicitud_id: s.id, p_via: "email" });
    const res = data as { ok?: boolean } | null;
    if (error || !res?.ok) {
      console.error(`[emails-reserva] fn_rechazar_propuesta_solicitud(${s.id}) falló:`, error?.message ?? JSON.stringify(data));
      return respuestaEnlace(ctx, error ? "error" : "invalido", detalles);
    }
    return respuestaEnlace(ctx, "hecho", detalles);
  }

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
  const estado = estadoTrasAceptarPropuesta(res);

  // Correo de la reserva recién creada (confirmada -> 'confirmada';
  // pendiente por lista negra -> 'solicitud_recibida'). Best-effort: la
  // reserva ya existe aunque el correo falle (entra en los reintentos).
  if (res?.ok && res.reserva_id && !res.ya_aceptada) {
    // Aceptar desde el correo = email verificado (doble opt-in). La reserva
    // hereda la casilla del newsletter de la solicitud en la BD (trigger
    // reservas_proteger_consentimiento_newsletter); esto dispara el alta.
    await registrarEmailVerificado(supabase as unknown as ClienteVerificacion, res.reserva_id, new Date().toISOString(), "emails-reserva");
    try {
      await enviarCorreoParaReserva(res.reserva_id);
    } catch (err) {
      console.error("[emails-reserva] Error mandando correo tras aceptar propuesta de solicitud:", err);
    }
  }
  if (estado === "error" && !error) {
    await avisoPanelBestEffort(
      "Un cliente aceptó la propuesta pero no se creó la reserva",
      `${s.nombre || "Cliente"} (${s.telefono || "sin teléfono"}): ${res?.error ?? "error desconocido"}. Llámale.`,
      s.id,
    );
  }
  return respuestaEnlace(ctx, estado, detalles);
}

async function ejecutarEnlace(token: string): Promise<RespuestaEnlace> {
  const ctx = await cargarContextoEnlace(token);
  if (!ctx) return respuestaInvalida(BASES_WEB);
  return ctx.tipo === "contraoferta" ? await ejecutarContraoferta(ctx) : await ejecutarPropuesta(ctx);
}

function jsonEnlace(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cabecerasCorsEnlace(req.headers.get("Origin"), ORIGENES_WEB),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function handleEnlace(req: Request, modo: "consultar" | "ejecutar"): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonEnlace(req, { ok: false, error: "invalid_json" }, 400);
  }
  const token = tokenDelCuerpo(body);
  if (!token) return jsonEnlace(req, respuestaInvalida(BASES_WEB));
  const respuesta = modo === "consultar" ? await consultarEnlace(token) : await ejecutarEnlace(token);
  return jsonEnlace(req, respuesta);
}

/**
 * Rutas GET antiguas (enlaces de correos ya enviados, y los "ejecutar" que
 * enlazaban las páginas HTML): 302 a la página de la web del negocio con el
 * MISMO token. No muta nada nunca — la acción solo ocurre con el POST de la
 * web tras el clic. Token malo o fila borrada -> web de Casa Tomás, que
 * enseña "enlace no válido".
 */
async function handleRedirigirAWeb(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") || "";
  let marca: Marca = marcaSegura(null);
  try {
    const ctx = token ? await cargarContextoEnlace(token) : null;
    if (ctx) marca = ctx.marca;
  } catch (err) {
    console.error("[emails-reserva] Error resolviendo la marca para redirigir (se usa Casa Tomás):", err);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: enlaceRespuestaWeb(BASES_WEB, marca, token),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
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
    .select("id, estado, fecha, email, nombre, notas_cliente") // nombre y notas: excluir datos de prueba (esReservaDePrueba)
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
/** Rutas GET de las antiguas páginas HTML: hoy solo redirigen a la web. */
const RUTAS_GET_ANTIGUAS = new Set([
  "aceptar",
  "rechazar",
  "rechazar/ejecutar",
  "propuesta/aceptar",
  "propuesta/aceptar/ejecutar",
  "propuesta/rechazar",
  "propuesta/rechazar/ejecutar",
]);

serve(async (req: Request) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const idx = segments.indexOf("emails-reserva");
  const route = (idx === -1 ? segments : segments.slice(idx + 1)).join("/");

  if (req.method === "OPTIONS") {
    // Las rutas /enlace/* solo aceptan las webs públicas (ver enlaces-web.ts);
    // el resto conserva el CORS abierto de siempre (panel, crons).
    const cabeceras = route.startsWith("enlace/")
      ? cabecerasCorsEnlace(req.headers.get("Origin"), ORIGENES_WEB)
      : corsHeaders;
    return new Response(null, { headers: cabeceras });
  }

  try {
    if (req.method === "POST" && route === "notificar") return await handleNotificar(req);
    if (req.method === "POST" && route === "recordatorios") return await handleRecordatorios(req);
    if (req.method === "POST" && route === "detectar-ausencias") return await handleDetectarAusencias(req);
    if (req.method === "POST" && route === "reintentar-fallidos") return await handleReintentarFallidos(req);
    if (req.method === "POST" && route === "enviar-prueba") return await handleEnviarPrueba(req);
    if (req.method === "POST" && route === "enviar-propuesta-solicitud") return await handleEnviarPropuestaSolicitud(req);
    if (req.method === "POST" && route === "notificar-modificacion") return await handleNotificarModificacion(req);
    // Páginas de los enlaces: las sirve la web; aquí solo JSON + redirección.
    if (req.method === "POST" && route === "enlace/consultar") return await handleEnlace(req, "consultar");
    if (req.method === "POST" && route === "enlace/ejecutar") return await handleEnlace(req, "ejecutar");
    if (req.method === "GET" && RUTAS_GET_ANTIGUAS.has(route)) return await handleRedirigirAWeb(req);
    return json({ ok: false, error: "not_found", route }, 404);
  } catch (err) {
    console.error("[emails-reserva] Error no controlado:", (err as Error)?.message, (err as Error)?.stack);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
