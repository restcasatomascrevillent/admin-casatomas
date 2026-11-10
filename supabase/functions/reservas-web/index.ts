// ============================================================
// RESERVAS WEB — Edge Function
// ============================================================
// Sustituye al workflow n8n "Reservas web" (5 webhooks: consulta de
// disponibilidad, crear reserva, notificar cambio de estado,
// confirmar, cancelar). Reutiliza fielmente la lógica YA PROBADA de
// restaurante-phone/api/vapi-webhook.js (aforo por turno, normalización
// de teléfono, blacklist, hora Madrid, solicitudes pendientes) en vez
// de reinventarla. Ver el informe de la migración para el detalle de
// qué se corrigió al portar (tokens de confirmar/cancelar, blacklist
// rota, datos falsos en la página de confirmación, plantillas
// intercambiadas, columna sala_id inexistente, etc.).
//
// Rutas (todas bajo /functions/v1/reservas-web/...):
//   POST /disponibilidad        JSON  -> aforo por turno y por hora
//   POST /crear                 JSON  -> crea una reserva 'pendiente'
//   GET  /confirmar?token=...   HTML  -> confirma la reserva (1 uso)
//   GET  /cancelar?token=...    HTML  -> pantalla "¿seguro?" (no muta)
//   GET  /cancelar/ejecutar?token=...  HTML -> cancela de verdad
//   (tabla de rutas en ./rutas.ts. `POST /notificar-estado` se RETIRÓ el
//   2026-09-30: estaba abierta sin secreto y mandaba correos "Estado de
//   reserva" a cualquier reserva — ver la cabecera de rutas.ts.)
//   Touza NO admite reservas (2026-10-01): las dos POST responden 409
//   `touza_sin_reservas` a toda petición de Touza, sin escribir nada — ver
//   `rechazoTouzaSinReservas` en reglas.ts.
//
// Secrets requeridos (Deno.env — nunca hardcodeados en el código):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (ya los inyecta la plataforma)
//   RESEND_API_KEY                            (ya existe en el proyecto)
//   RESERVAS_WEB_TOKEN_SECRET                 (verifica la firma HMAC de los tokens)
// Opcionales:
//   RESEND_FROM_EMAIL            (por defecto: sandbox de Resend, ver informe)
//   RESERVAS_WEB_SHARED_SECRET   (si se define, exige header x-webhook-secret
//                                 en las 2 acciones POST. OJO: los frontends
//                                 NO mandan ese header, así que definirlo
//                                 rompe las reservas web; ver
//                                 `secretoCompartidoValido` en rutas.ts)
//   RESERVAS_WEB_ALLOWED_ORIGIN  (CORS; por defecto '*', igual que el resto
//                                 de funciones de este proyecto)
//   RESERVAS_WEB_PUBLIC_URL      (base para los enlaces de los emails; por
//                                 defecto se deriva de SUPABASE_URL)
//   RESERVAS_WEB_CONDICIONES_OBLIGATORIAS (por defecto se EXIGE la casilla
//                                 `acepta_condiciones` en POST /crear; solo
//                                 "false" lo desactiva. Interruptor de
//                                 transición/emergencia: se lee en cada
//                                 petición, así que cambiar el secret no
//                                 obliga a redesplegar. Ver
//                                 `condicionesObligatorias` en reglas.ts)
//
// Cuerpo de POST /crear — casillas RGPD (2026-10-03, ver reglas.ts):
//   acepta_condiciones        boolean, obligatoria (=== true) -> si no, 400
//                             `condiciones_no_aceptadas`
//   consentimiento_newsletter boolean, opcional (=== true) -> se guarda en
//                             `reservas.consentimiento_newsletter` (o en la
//                             solicitud pendiente si no se puede crear). Doble
//                             opt-in (20261003184500): el alta en el newsletter
//                             llega cuando el cliente pulsa «Confirmo» en el
//                             correo (reservas.email_verificado_at), no aquí
// ============================================================

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient as createClientBase, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

// Motor de disponibilidad — MISMO modulo que usa el panel (src/hooks/useDisponibilidad.ts).
// Es TypeScript puro sin dependencias: corre igual en Deno y en el navegador.
import {
  calcularDisponibilidad,
  validarHoraOfrecida,
  ahoraEnMadrid,
  ESTADOS_QUE_OCUPAN,
  HORA_CORTE_TURNO,
  sumarCapacidadPorMarca,
  filtrarEspaciosPorMarca,
  esCaracteristicaPrivada,
  idsSalasPrivadas,
  salasCerradasPorEventoDesdeFilas,
  type SalaCerradaPorEvento,
  type ConfiguracionTurnoInput,
  type ReservaOcupante,
} from "../_shared/disponibilidad.ts";

// Datos de negocio (Casa Tomás / Touza), resolución de marca y las
// plantillas de correo: ver `plantillas.ts` — módulo puro, sin imports de
// Deno, separado a propósito para poder testearlo con vitest.
import {
  NEGOCIOS,
  NEGOCIO_POR_DEFECTO,
  esMarcaValida,
  resolverMarca,
  construirAvisoEmailFallido,
  mensajeDeError,
  debeCrearAvisoEmailFallido,
  escapeHtml,
  // `tplSolicitudRecibida` ya NO se usa aqui: ese correo primero paso a
  // mandarlo `emails-reserva` desde `plantillas_email_reserva` y desde el
  // 2026-09-28 NO SE MANDA en el canal web (ver `handleCrear`). Se deja
  // exportada y probada en plantillas.ts como referencia del texto
  // historico; retirarla es una decision aparte.
  //
  // `debeAvisarDeEmailsReserva` / `MOTIVOS_EMAILS_RESERVA_CON_CUSTODIA`
  // tampoco se importan ya (su unico uso era decidir si avisar cuando fallaba
  // la delegacion de ESE correo). Siguen exportados y probados en
  // plantillas.ts: volver a necesitarlos es volver a importarlos.
  tplSolicitudNoProcesada,
  type Marca,
  type DatosNegocio,
  type AvisoEmailFallidoInput,
  type ResultadoNotificarEmailsReserva,
} from "./plantillas.ts";
import { resolverRuta, rutaDelPath, secretoCompartidoValido } from "./rutas.ts";
// Cierres de reservas (lunes, jueves, domingo noche + calendario del panel).
import {
  normalizarServiciosCerrados,
  serviciosCerradosPorSemana,
  textoTurnosCerrados,
  turnoDeHoraServicio,
  turnosCerradosEn,
  type ServicioCerrado,
  type TurnoServicio,
} from "../_shared/cierres.ts";
// Doble opt-in del newsletter (migración 20261003184500): ver handleConfirmar.
import { registrarEmailVerificado, type ClienteVerificacion } from "../_shared/verificacion-email.ts";

// Reglas de sala del alta (reservas-sin-salas) y el rechazo de Touza (no admite
// reservas, 2026-10-01): módulo puro, testeado con vitest.
import {
  rechazarPorSala,
  contarEspaciosQueCaben,
  salaDelCliente,
  rechazoTouzaSinReservas,
  leerConsentimientos,
  condicionesObligatorias,
  rechazoCondicionesNoAceptadas,
  esColumnaInexistente,
  camposConsentimientoSolicitud,
  faltaColumnaConsentimientoSolicitud,
  interpretarSondeoDobleOptin,
  consentimientoNewsletterParaGuardar,
  turnosBloqueadosDesdeFilas,
  rechazoServicioBloqueado,
  rechazoMismoDiaTelefono,
  rechazoMenuDelDia,
  leerMenuDelDia,
  motivoHoraNoOfrecidaWeb,
  type TurnoWeb,
  type ConsentimientosReserva,
  type EstadoDobleOptin,
} from "./reglas.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import {
  puedeEnviarCorreoRechazo,
  reservarCupoCrear,
  reservarCupoDisponibilidad,
  respuestaDemasiadasSolicitudes,
  respuestaLimitadorNoDisponible,
} from "./limitador.ts";
const createClient = clienteConAuditoria(createClientBase, "reservas-web");

// ------------------------------------------------------------
// CONFIGURACIÓN
// ------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Casa Tomás <onboarding@resend.dev>";
const TOKEN_SECRET = Deno.env.get("RESERVAS_WEB_TOKEN_SECRET") ?? "";
const SHARED_SECRET = Deno.env.get("RESERVAS_WEB_SHARED_SECRET") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("RESERVAS_WEB_ALLOWED_ORIGIN") || "*";
const PUBLIC_BASE_URL = Deno.env.get("RESERVAS_WEB_PUBLIC_URL") || `${SUPABASE_URL}/functions/v1/reservas-web`;
// Sal del HMAC de la IP para el limitador de /crear (CT-REM-FN-07). Si falta
// RESERVAS_WEB_IP_SALT se usa la service role key (secreta y estable entre
// isolates, que es lo que importa para contar por IP), como chat-web.
const IP_SALT = Deno.env.get("RESERVAS_WEB_IP_SALT") || SUPABASE_SERVICE_ROLE_KEY || "";

// Correo de "solicitud recibida": YA NO SE MANDA en el canal web
// (2026-09-28, ver `handleCrear`). Esta configuracion se queda porque
// `notificarViaEmailsReserva` sigue en el fichero como punto de reenganche.
// El secreto es el MISMO que ya usa `notify-reservation-change` y es un
// secreto del proyecto, asi que no hay que crear ninguno nuevo. Si faltara,
// `comprobarSecretoCompartido` en emails-reserva falla CERRADO (401) -> aqui
// sale `contactado:false` -> aviso interno; nunca silencio.
const EMAILS_RESERVA_SHARED_SECRET = Deno.env.get("EMAILS_RESERVA_SHARED_SECRET") ?? "";
const EMAILS_RESERVA_URL = `${SUPABASE_URL}/functions/v1/emails-reserva/notificar`;
// Mas largo que los 5 s de `notify-reservation-change`, a proposito: esta
// llamada va FUERA del camino critico de la respuesta (ver `enSegundoPlano`),
// asi que no corre ninguna prisa, y abortarla antes de tiempo mientras
// emails-reserva si esta completando el envio (su propio timeout contra
// Resend es de 15 s) produciria un aviso interno falso.
const EMAILS_RESERVA_TIMEOUT_MS = 20_000;

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// Sin RESEND_API_KEY (la demo no manda correos) `new Resend("")` lanza al ARRANCAR
// y la función entera da WORKER_ERROR: se crea solo si hay clave (ver `sendEmail`).
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const RESTAURANTE_TEL_TEXTO = "966 10 78 87";
const RESTAURANTE_TEL_HREF = "966107887";

// ------------------------------------------------------------
// HELPERS DE RESPUESTA
// ------------------------------------------------------------
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

// escapeHtml: ver plantillas.ts (importado arriba). Bug corregido al
// portar: la página de cancelar interpolaba $json.query.nombre (y
// fecha/hora/comensales) SIN escapar dentro de HTML — un enlace manipulado
// podía inyectar HTML/JS (XSS reflejado). Toda interpolación de datos que
// vienen de fuera se pasa por `escapeHtml`.

// Guarda OPCIONAL de las dos rutas POST públicas (/disponibilidad, /crear).
// Falla ABIERTO a propósito: el navegador no manda `x-webhook-secret`. NO
// usarla para proteger nada que no deba ser público — ver
// `secretoCompartidoValido` en rutas.ts y la retirada de /notificar-estado.
function checkSharedSecret(req: Request): boolean {
  return secretoCompartidoValido(SHARED_SECRET, req.headers.get("x-webhook-secret"));
}

// ============================================================
// LÓGICA PORTADA DE restaurante-phone/api/vapi-webhook.js
// (fiel al original citado entre paréntesis; ajustes de porting anotados)
// ============================================================

// --- normalizePhone (vapi-webhook.js:142) ---
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  let normalized = phone.replace(/[\s\-()+.]/g, "");
  if (normalized.startsWith("0034")) normalized = normalized.slice(4);
  if (normalized.startsWith("34") && normalized.length === 11) normalized = normalized.slice(2);
  return normalized;
}

// --- hora Madrid (vapi-webhook.js:734,750) — Deno Deploy también corre en UTC ---
function parseFechaHoraMadrid(fecha: string, hora: string): Date {
  const utcRef = new Date(`${fecha}T${hora}:00.000Z`);
  const madridStr = utcRef.toLocaleString("sv-SE", { timeZone: "Europe/Madrid" });
  const madridAsUTC = new Date(madridStr.replace(" ", "T") + "Z");
  const offsetMs = utcRef.getTime() - madridAsUTC.getTime();
  return new Date(utcRef.getTime() + offsetMs);
}
function hoyEnMadrid(): Date {
  const madridStr = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Madrid" });
  return new Date(madridStr.split(" ")[0] + "T00:00:00Z");
}

// --- sanitizeForIlike (vapi-webhook.js:908) ---
function sanitizeForIlike(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/[%_().,*\\]/g, "\\$&");
}

// --- configuracion_reservas (vapi-webhook.js:655 getReservationConfig) ---
interface ReservationConfig {
  minutos_corte_antes_servicio: number;
  max_reservas_por_telefono_dia: number;
  max_reservas_por_email_dia: number;
  max_comensales_por_reserva: number;
  min_comensales_por_reserva: number;
  dias_max_antelacion: number;
  telefono_obligatorio: boolean;
  email_obligatorio: boolean;
  auto_confirmar: boolean;
}
async function getReservationConfig(): Promise<ReservationConfig> {
  const { data } = await supabase.from("configuracion_reservas").select("*").limit(1).single();
  return (data as ReservationConfig) || ({} as ReservationConfig);
}

// --- Cierres de reservas (migración 20261013120000) ---
// La regla es la RPC `servicios_cerrados_reserva`, la misma que usan el bot
// y el panel. Si aún no existe (migración sin aplicar) o falla, se aplica la
// regla semanal por defecto de `_shared/cierres.ts`.
async function leerServiciosCerrados(desde: string, hasta: string): Promise<ServicioCerrado[]> {
  try {
    const { data, error } = await supabase.rpc("servicios_cerrados_reserva", { p_desde: desde, p_hasta: hasta });
    if (error) throw error;
    return normalizarServiciosCerrados(data);
  } catch (err) {
    console.warn("[CIERRES] RPC no disponible, regla por defecto:", (err as Error)?.message || err);
    return serviciosCerradosPorSemana(desde, hasta);
  }
}
async function turnosCerradosDe(fecha: string): Promise<TurnoServicio[]> {
  return turnosCerradosEn(await leerServiciosCerrados(fecha, fecha), fecha);
}

// --- Salas cerradas por un EVENTO (20261119100000) ---
// Filas de `salas_cerradas_servicio` con `reserva_id`: esa sala está entera
// para un evento ese día y turno. Restan su capacidad del aforo de su turno y
// el evento no consume aforo (igual que el trigger). Si la tabla o la columna
// aún no existen (migración sin aplicar) o falla la lectura, no se resta nada:
// el trigger sigue siendo la última palabra.
async function salasCerradasPorEventoDe(
  fecha: string,
  espacios: ReadonlyArray<{ id?: string | null; capacidad_maxima?: number | null; caracteristicas?: unknown }> | null,
  marca: string,
): Promise<SalaCerradaPorEvento[]> {
  try {
    const { data, error } = await supabase
      .from("salas_cerradas_servicio")
      .select("espacio_id, turno, reserva_id")
      .eq("fecha", fecha);
    if (error) return [];
    return salasCerradasPorEventoDesdeFilas(
      data as Array<{ espacio_id: string; turno: string; reserva_id: string | null }> | null,
      espacios,
      marca,
    );
  } catch {
    return [];
  }
}

// --- Servicios bloqueados para la web (20261122100000) ---
// Turnos de ese día que el panel ha cerrado a las reservas online. Si la tabla
// aún no existe (migración sin aplicar) o falla la lectura, no se bloquea
// nada (se avisa en el log): la web sigue funcionando como antes.
async function turnosBloqueadosDe(fecha: string): Promise<TurnoWeb[]> {
  try {
    const { data, error } = await supabase.from("servicios_bloqueados").select("turno").eq("fecha", fecha);
    if (error) {
      console.warn("[BLOQUEOS] servicios_bloqueados no legible:", error.message);
      return [];
    }
    return turnosBloqueadosDesdeFilas(data as Array<{ turno: unknown }> | null);
  } catch (err) {
    console.warn("[BLOQUEOS] servicios_bloqueados no legible:", (err as Error)?.message || err);
    return [];
  }
}

// --- Blacklist ---
// El encargo cita `isBlacklisted`, pero esa función (vapi-webhook.js:665)
// SOLO mira teléfono (tipo='telefono', comparación exacta tras normalizar) y
// se usa en fnFindReservation. La que de verdad se usa al CREAR una reserva
// —el caso análogo a esta acción— es `verificarBlacklist` (vapi-webhook.js:915),
// que sí comprueba teléfono Y email. Es la que se porta aquí.
// Fix de porting: si ambos valores sanitizan a cadena vacía (input basura),
// el array `queries` queda vacío y `.or('')` lanzaría un error de PostgREST;
// se corta antes con un `return false` explícito.
async function verificarBlacklist(telefono: string | null, email: string | null): Promise<boolean> {
  if (!telefono && !email) return false;
  const telefonoSanitizado = telefono ? telefono.replace(/[^\d+]/g, "") : "";
  const emailSanitizado = email ? email.replace(/[^a-zA-Z0-9@._-]/g, "") : "";
  const queries: string[] = [];
  if (telefonoSanitizado) {
    queries.push(`valor.ilike.%${sanitizeForIlike(telefonoSanitizado)}%`);
    const norm = normalizePhone(telefonoSanitizado);
    if (norm && norm !== telefonoSanitizado) queries.push(`valor.ilike.%${sanitizeForIlike(norm)}%`);
  }
  if (emailSanitizado) {
    queries.push(`valor.ilike.%${sanitizeForIlike(emailSanitizado)}%`);
  }
  if (queries.length === 0) return false; // fix: evita .or('') con input solo-basura
  try {
    const { data, error } = await supabase.from("blacklist").select("motivo").or(queries.join(",")).limit(1);
    if (error) throw error;
    if (data && data.length > 0) return true;
  } catch (err) {
    console.error("[BLACKLIST] Error verificando:", (err as Error)?.message || err);
  }
  return false;
}

// --- solicitudes_pendientes (vapi-webhook.js:812 registrarSolicitudPendiente) ---
interface SolicitudPendienteInput {
  nombre?: string | null;
  telefono?: string | null;
  email?: string | null;
  fecha?: string | null;
  hora?: string | null;
  comensales?: number | null;
  notas?: string | null;
  motivo: string;
  descripcion?: string;
  /** Negocio de la solicitud (columna de 20260930100000). Se guarda: ya no
   * se deduce de la sala, que en Casa Tomás es interna. */
  marca: Marca;
  /** Casillas RGPD del formulario (migración 20261003184500): la del
   * newsletter pasa a la reserva que salga de la solicitud. */
  consentimientos?: ConsentimientosReserva;
}
// ¿Está aplicada 20261003184500 (doble opt-in)? Ver la salvaguarda en
// reglas.ts: sin ella, guardar la casilla del newsletter en la reserva daría
// de alta al instante sin verificar el email (trigger antiguo). Solo se
// recuerda el "sí" (la columna no desaparece); un "no" o un fallo se vuelve a
// comprobar en la siguiente reserva, así que aplicar la migración surte efecto
// sin redesplegar.
let dobleOptinConfirmado = false;
async function estadoDobleOptin(): Promise<EstadoDobleOptin> {
  if (dobleOptinConfirmado) return "activo";
  try {
    const { error } = await supabase.from("reservas").select("email_verificado_at").limit(0);
    const estado = interpretarSondeoDobleOptin(error);
    if (estado === "activo") dobleOptinConfirmado = true;
    else console.error(`[CREAR] Doble opt-in ${estado} (¿migración 20261003184500 sin aplicar?): la casilla del newsletter NO se guarda en la reserva.`, error?.code, error?.message);
    return estado;
  } catch (err) {
    console.error("[CREAR] No se pudo comprobar el doble opt-in; la casilla del newsletter NO se guarda:", (err as Error)?.message || err);
    return "desconocido";
  }
}

async function registrarSolicitudPendiente(input: SolicitudPendienteInput): Promise<void> {
  try {
    const fila: Record<string, unknown> = {
      nombre: input.nombre || null,
      telefono: input.telefono || null,
      email: input.email || null,
      fecha_solicitada: input.fecha || null,
      hora_solicitada: input.hora || null,
      numero_comensales: input.comensales || null,
      notas_cliente: input.notas || null,
      motivo_rechazo: input.motivo,
      descripcion_rechazo: input.descripcion || null,
      estado: "pendiente",
      marca: input.marca,
      ...camposConsentimientoSolicitud(input.consentimientos, new Date().toISOString()),
    };
    let { error } = await supabase.from("solicitudes_pendientes").insert(fila);
    // Función desplegada antes que la migración 20261003184500: la solicitud
    // se guarda igual, sin las casillas (se pierden, como antes).
    if (error && faltaColumnaConsentimientoSolicitud(error)) {
      console.error("[SOLICITUD] Faltan las columnas de consentimiento en solicitudes_pendientes (¿migración 20261003184500 sin aplicar?). Se guarda sin ellas.");
      const { consentimiento_newsletter: _c, condiciones_aceptadas_at: _a, ...sinConsentimiento } = fila;
      ({ error } = await supabase.from("solicitudes_pendientes").insert(sinConsentimiento));
    }
    if (error) console.error("[SOLICITUD] Error al registrar:", error.message);
  } catch (err) {
    console.error("[SOLICITUD] Error inesperado:", (err as Error)?.message || err);
  }
}

// --- Aforo por turno (vapi-webhook.js:680 getEspaciosConOcupacion) ---
// MISMO criterio de turno que el trigger `trg_validar_capacidad` (comida
// < 17:00, cena >= 17:00) que ya protege `reservas` en producción — no se
// duplica su autoridad, solo se anticipa el resultado para dar una
// respuesta clara antes del INSERT.
// Deliberadamente NO se usa `vista_ocupacion`/`ocupacion_diaria`: en
// producción están desincronizadas (mayoría de filas huérfanas, ocupación
// fantasma) y el trigger que las mantiene usa un umbral de turno distinto
// (<16:00) al del trigger de aforo (<17:00). Ver informe.
interface EspacioOcupacion {
  id: string;
  nombre: string;
  capacidad_maxima: number;
  disponible: number;
  ocupacion: number;
}
interface OcupacionResultado {
  espacios: EspacioOcupacion[];
  capacidadTotal: number;
  ocupacionTotal: number;
}
// `marca` es OBLIGATORIO (no opcional con default aquí dentro): las dos
// llamadas a Supabase de esta función ya necesitan saberla para filtrar
// (espacios por `caracteristicas->>'marca'`, reservas por la columna
// `marca`), así que quien llama la resuelve primero con `resolverMarca`
// (ver plantillas.ts) y no hay un valor "neutro" razonable que adivinar
// aquí dentro si se olvidara pasarla.
async function getEspaciosConOcupacion(fecha: string, horaConsulta: string | null, marca: Marca): Promise<OcupacionResultado> {
  const { data: espaciosRaw } = await supabase
    .from("espacios_reserva")
    .select("id, nombre, capacidad_maxima, caracteristicas")
    .eq("activa", true);

  // Filtra a la marca pedida ANTES de construir nada: ni el desglose por
  // espacio (`espacios`, que en Touza decide si el grupo cabe en un espacio,
  // ver `rechazarPorSala` en reglas.ts) ni
  // `capacidadTotal` deben ver espacios de otro negocio. Bug corregido
  // 2026-09-22: antes sumaba TODOS los espacios activos sin mirar la marca
  // (150 -> 170 al dar de alta "El Reservado", de Touza). Mismo criterio
  // que el trigger `validar_capacidad_reserva`, ver `20260922190000_
  // aforo_por_marca.sql` y `sumarCapacidadPorMarca`/`filtrarEspaciosPorMarca`
  // en `_shared/disponibilidad.ts`.
  //
  // SALAS PRIVADAS FUERA DE AFORO (2026-10-03, el «Reservado»): ni suman su
  // capacidad (`sumarCapacidadPorMarca` las salta con `privada`), ni se
  // ofrecen como espacio (la web nunca asigna sala privada), ni sus reservas
  // (que solo se crean desde el panel) consumen aforo. Igual que el trigger.
  const espaciosDeLaMarca = filtrarEspaciosPorMarca(
    ((espaciosRaw || []) as Array<{ id: string; nombre: string; capacidad_maxima: number; caracteristicas: Record<string, unknown> | null }>).map((e) => ({
      ...e,
      marca: (e.caracteristicas?.marca as string | undefined) ?? null,
      privada: esCaracteristicaPrivada(e.caracteristicas),
    })),
    marca,
  );
  const idsPrivadas = idsSalasPrivadas((espaciosRaw || []) as Array<{ id: string; caracteristicas: Record<string, unknown> | null }>);

  const { data: reservas } = await supabase
    .from("reservas")
    .select("espacio_id, numero_comensales, hora")
    .eq("fecha", fecha)
    // Misma marca que se está comprobando: `reservas.marca` es `NOT NULL
    // DEFAULT 'casa_tomas'` (migración 20260922180000), así que un `.eq()`
    // normal ya es exactamente el `COALESCE(marca, 'casa_tomas') = v_marca`
    // del trigger, sin tener que emularlo aquí.
    .eq("marca", marca)
    .in("estado", ["pendiente", "verificada", "confirmada"]);

  // El "17:00" ya no está escrito a mano aquí: sale de `HORA_CORTE_TURNO`,
  // la misma constante que usa el motor compartido y que copia el trigger.
  const esTurnoComida = horaConsulta ? horaConsulta < HORA_CORTE_TURNO : null;
  // Salas cerradas por un evento en el turno consultado: fuera del aforo y
  // del desglose; el evento que está en ellas no ocupa.
  const cerradasEvento = esTurnoComida === null
    ? []
    : (await salasCerradasPorEventoDe(fecha, espaciosRaw as Array<{ id: string; capacidad_maxima: number; caracteristicas: unknown }> | null, marca))
        .filter((c) => c.turno === (esTurnoComida ? "comida" : "cena"));
  const idsCerradasEvento = new Set(cerradasEvento.map((c) => c.espacio_id));
  const reservasMismoTurno = (reservas || []).filter((r: { hora: string; espacio_id?: string | null }) => {
    if (r.espacio_id && idsPrivadas.includes(r.espacio_id)) return false;
    if (r.espacio_id && idsCerradasEvento.has(r.espacio_id)) return false;
    if (esTurnoComida === null) return true;
    const rEsComida = r.hora < `${HORA_CORTE_TURNO}:00`;
    return rEsComida === esTurnoComida;
  });

  const ocupacionPorEspacio: Record<string, number> = {};
  for (const r of reservasMismoTurno as Array<{ espacio_id: string | null; numero_comensales: number }>) {
    if (r.espacio_id) ocupacionPorEspacio[r.espacio_id] = (ocupacionPorEspacio[r.espacio_id] || 0) + r.numero_comensales;
  }

  const resultado: EspacioOcupacion[] = espaciosDeLaMarca.filter((e) => !e.privada && !idsCerradasEvento.has(e.id)).map((e) => ({
    id: e.id,
    nombre: e.nombre,
    capacidad_maxima: e.capacidad_maxima,
    ocupacion: ocupacionPorEspacio[e.id] || 0,
    disponible: e.capacidad_maxima - (ocupacionPorEspacio[e.id] || 0),
  }));

  const capacidadTotal = Math.max(
    0,
    sumarCapacidadPorMarca(espaciosDeLaMarca, marca) - cerradasEvento.reduce((s, c) => s + c.capacidad_maxima, 0),
  );
  const ocupacionTotal = (reservasMismoTurno as Array<{ numero_comensales: number }>).reduce((s, r) => s + (r.numero_comensales || 0), 0);

  return { espacios: resultado, capacidadTotal, ocupacionTotal };
}

// ============================================================
// TOKENS DE UN SOLO USO (confirmar / cancelar)
// ============================================================
// FALLO GRAVE corregido: hoy confirmar/cancelar filtran por nombre
// (y a veces fecha/hora) tomados de la query string, sin ningún secreto
// — cualquiera puede confirmar o cancelar la reserva de otro con solo
// adivinar/editar la URL.
//
// Diseño elegido: HMAC-SHA256 (Web Crypto, sin dependencias) sobre un
// payload { id, action, exp, fp }, SIN estado en base de datos (no hace
// falta una migración nueva ni tocar nada fuera de esta carpeta):
//   - `exp`: caducidad (14 días — cubre de sobra el tiempo entre el email
//     de "confirma tu asistencia" y la fecha de la reserva).
//   - `fp` ("fingerprint"): `estado + '|' + updated_at` de la reserva EN
//     EL MOMENTO de generar el token (justo cuando se manda el email).
//
// 2026-09-30: la FIRMA (`signReservaToken`) se retiró junto con
// `/notificar-estado`, que era el único sitio que generaba tokens. Aquí
// solo queda la VERIFICACIÓN, para que los enlaces ya enviados (caducan a
// los 14 días) sigan funcionando. Los correos de estado nuevos los manda
// `emails-reserva`, con sus propios tokens (EMAILS_RESERVA_TOKEN_SECRET).
//     Al verificar se recalcula `fp` desde el estado ACTUAL en BD; si no
//     coincide, el token se rechaza. Como confirmar/cancelar siempre
//     cambian `estado` (y el trigger `update_reservas_updated_at` cambia
//     `updated_at` en cualquier UPDATE), el primer uso invalida el token
//     para cualquier reintento — de un solo uso sin tabla de tokens.
// La firma se verifica con `crypto.subtle.verify` (comparación segura
// frente a timing attacks; no se compara con `===` a mano).
function b64urlDecode(str: string): Uint8Array {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
}

type TokenAction = "confirmar" | "cancelar";
interface ReservaTokenPayload {
  id: string;
  action: TokenAction;
  exp: number;
  fp: string;
}

async function verifyReservaToken(token: string, action: TokenAction): Promise<ReservaTokenPayload | null> {
  if (!TOKEN_SECRET) {
    console.error("[TOKEN] RESERVAS_WEB_TOKEN_SECRET no configurado — rechazando token (fail closed)");
    return null;
  }
  const parts = (token || "").split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  try {
    const key = await hmacKey(TOKEN_SECRET);
    const valid = await crypto.subtle.verify("HMAC", key, b64urlDecode(sigB64), new TextEncoder().encode(payloadB64));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as ReservaTokenPayload;
    if (payload.action !== action) return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function fingerprint(estado: string, updatedAt: string): string {
  return `${estado}|${updatedAt}`;
}

// ============================================================
// RESERVA: tipo + lookup
// ============================================================
interface Reserva {
  id: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  fecha: string;
  hora: string;
  numero_comensales: number;
  estado: string;
  notas_cliente: string | null;
  espacio_id: string | null;
  canal: string | null;
  // Columna nueva (migración `20260922180000_marca_negocio_en_reservas.sql`,
  // NO aplicada) — `text` a propósito, no `Marca`: es lo que devuelve la
  // BD sin validar todavía. Se normaliza con `negocioDeReserva` más abajo.
  marca: string | null;
  updated_at: string;
}
async function fetchReserva(id: string): Promise<Reserva | null> {
  const { data, error } = await supabase.from("reservas").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as Reserva;
}

// Normaliza `reserva.marca` (columna `text`, podría en teoría traer un valor
// fuera de `Marca` si algo escribió en la fila sin pasar por el CHECK — no
// debería pasar con la migración aplicada, pero esta función es la red de
// seguridad final: nunca deja pasar un valor no reconocido a una plantilla).
function negocioDeReserva(reserva: Pick<Reserva, "marca">): DatosNegocio {
  return NEGOCIOS[esMarcaValida(reserva.marca) ? reserva.marca : NEGOCIO_POR_DEFECTO];
}

// ============================================================
// EMAIL — Resend (plantillas HTML de Gmail/n8n, preservadas tal cual)
// ============================================================
async function sendEmail(to: string, subject: string, htmlBody: string): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY || !resend) {
    console.error("[EMAIL] RESEND_API_KEY no configurado — email no enviado");
    return { ok: false, error: "resend_not_configured" };
  }
  try {
    const { error } = await resend.emails.send({ from: RESEND_FROM_EMAIL, to: [to], subject, html: htmlBody });
    if (error) {
      console.error("[EMAIL] Resend error:", error);
      // BUG ENCONTRADO Y CORREGIDO AQUÍ (QA contra producción, verificado
      // con datos reales): `error` aquí es el objeto PLANO {name, message}
      // del SDK de Resend, no una `Error` — `String(error)` daba literalmente
      // "[object Object]", que `construirAvisoEmailFallido` (plantillas.ts)
      // interpolaba tal cual en notificaciones_dashboard.mensaje. Ver el
      // razonamiento completo (por qué emails-reserva no tiene este fallo,
      // qué formas de entrada cubre) en `mensajeDeError`, plantillas.ts.
      return { ok: false, error: mensajeDeError(error, "error_resend_desconocido") };
    }
    return { ok: true };
  } catch (err) {
    console.error("[EMAIL] Excepción enviando email:", (err as Error)?.message || err);
    return { ok: false, error: mensajeDeError(err, "excepcion_desconocida") };
  }
}

// ------------------------------------------------------------
// TAREAS FUERA DEL CAMINO CRITICO DE LA RESPUESTA
// ------------------------------------------------------------
// El cuerpo de la respuesta de `/crear` no depende en nada del correo: el
// cliente ya sabe por el propio 201 que su solicitud entro. Mandarlo ANTES
// de responder solo suma latencia al boton "Reservando..." del formulario.
// `EdgeRuntime.waitUntil` es la API de tareas en segundo plano del runtime
// de Supabase: mantiene vivo el worker hasta que la promesa termina, aunque
// la respuesta ya se haya devuelto.
//
// FALLBACK DELIBERADO: si `EdgeRuntime.waitUntil` no existe (dev local con
// otro runtime, tests, o un cambio futuro de plataforma) se ESPERA la tarea
// antes de responder. Peor latencia -la de hoy, ni un ms mas- pero jamas un
// correo perdido: un `void promesa` suelto moriria con el isolate.
declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

async function enSegundoPlano(tarea: Promise<unknown>, etiqueta: string): Promise<void> {
  const protegida = tarea.catch((err) => {
    console.error(`[SEGUNDO_PLANO] ${etiqueta}:`, (err as Error)?.message || err);
  });
  const runtime = typeof EdgeRuntime !== "undefined" ? EdgeRuntime : undefined;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(protegida);
    return;
  }
  console.warn(`[SEGUNDO_PLANO] EdgeRuntime.waitUntil no disponible — se espera a "${etiqueta}" antes de responder.`);
  await protegida;
}

// ------------------------------------------------------------
// DELEGACION EN `emails-reserva` (registro + reintentos + seguimiento)
// ------------------------------------------------------------
// Mismo contrato que usa `notify-reservation-change`: POST /notificar con
// `{ reserva_id }`. `emails-reserva` deriva el tipo de plantilla del ESTADO
// de la reserva (`tipoEmailParaEstado`) y del CANAL: para una reserva web en
// 'pendiente' devuelve null a proposito y no manda nada (ver
// `debeEnviarSolicitudRecibida` en emails-reserva/plantillas.ts). No se le
// puede forzar el tipo ni el destinatario: los lee de la fila de `reservas`.
//
// Devuelve SIEMPRE un resultado (nunca lanza): quien lo llama decide si
// avisar con `debeAvisarDeEmailsReserva` (pura, en plantillas.ts).
//
// SIN LLAMADORES desde el 2026-09-28 (el correo de "solicitud recibida" se
// quito del canal web — ver el bloque del final de `handleCrear`). Se
// mantiene a proposito: es el contrato de
// delegacion ya escrito y probado, y el sitio exacto donde volver a
// engancharse si el dueño cambia de idea.
async function notificarViaEmailsReserva(reservaId: string): Promise<ResultadoNotificarEmailsReserva> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // emails-reserva tiene verify_jwt = false, pero se manda igual por si
    // algun dia cambia — mismo criterio que notify-reservation-change.
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  if (EMAILS_RESERVA_SHARED_SECRET) headers["x-webhook-secret"] = EMAILS_RESERVA_SHARED_SECRET;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMAILS_RESERVA_TIMEOUT_MS);
  try {
    const respuesta = await fetch(EMAILS_RESERVA_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ reserva_id: reservaId }),
      signal: controller.signal,
    });
    if (!respuesta.ok) {
      const texto = await respuesta.text().catch(() => "");
      console.error(`[EMAILS_RESERVA] HTTP ${respuesta.status}: ${texto.slice(0, 300)}`);
      return { contactado: false, ok: false, motivo: `http_${respuesta.status}` };
    }
    const cuerpo = (await respuesta.json().catch(() => null)) as { ok?: boolean; motivo?: string } | null;
    if (!cuerpo || typeof cuerpo.ok !== "boolean") {
      console.error("[EMAILS_RESERVA] Respuesta 2xx sin cuerpo JSON reconocible");
      return { contactado: false, ok: false, motivo: "respuesta_ilegible" };
    }
    if (!cuerpo.ok) console.warn(`[EMAILS_RESERVA] No enviado: ${cuerpo.motivo ?? "sin_motivo"}`);
    return { contactado: true, ok: cuerpo.ok, motivo: cuerpo.motivo ?? null };
  } catch (err) {
    const esTimeout = (err as Error)?.name === "AbortError";
    console.error("[EMAILS_RESERVA] Fallo de transporte:", (err as Error)?.message || err);
    return { contactado: false, ok: false, motivo: esTimeout ? "timeout" : "error_de_red" };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Aviso interno cuando `sendEmail` falla — ver `construirAvisoEmailFallido`
// en plantillas.ts para el porqué y el contrato. Este wrapper es el único
// que hace I/O (Supabase); el contenido del aviso ya viene armado y
// probado por separado.
//
// MARGEN ANTI-ALUVIÓN PROPIO — BUG ENCONTRADO Y CORREGIDO AQUÍ (verificado
// en la prueba de QA): antes de este cambio, esta función insertaba SIN
// NINGÚN cooldown propio — una caída de Resend habría generado un aviso por
// cada email fallido, sin límite. Ahora comprueba, por `origen` Y por
// `prioridad` (ver el bloque "MARGEN ANTI-ALUVIÓN COMPARTIDO ENTRE
// TUBERÍAS" en plantillas.ts para el porqué de los dos ejes), si el último
// aviso de ESTE carril es lo bastante reciente antes de insertar uno nuevo.
// Devuelve `boolean` (¿se creó el aviso?) — mismo contrato que
// `emails-reserva/index.ts::avisarEnviosDefinitivamentePerdidos`, aunque
// ningún llamador de aquí mira todavía el valor de retorno.
async function avisarEmailFallido(params: AvisoEmailFallidoInput): Promise<boolean> {
  const fila = construirAvisoEmailFallido(params);
  try {
    const ahora = new Date().toISOString();
    const { data: ultimo, error: errUltimo } = await supabase
      .from("notificaciones_dashboard")
      .select("created_at")
      .eq("tipo", "email_fallido")
      .eq("origen", fila.origen)
      .eq("prioridad", fila.prioridad)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (errUltimo) {
      // Fail-open, igual que emails-reserva: un error comprobando el
      // cooldown nunca debe silenciar un aviso real.
      console.error("[EMAIL_FALLIDO] Error comprobando el ultimo aviso (se avisa igualmente):", errUltimo.message);
    } else if (!debeCrearAvisoEmailFallido((ultimo?.created_at as string | undefined) ?? null, ahora)) {
      console.log(
        `[EMAIL_FALLIDO] Aviso omitido por cooldown (origen=${fila.origen}, prioridad=${fila.prioridad}, ya hay uno reciente del mismo carril).`,
      );
      return false;
    }

    const { error } = await supabase.from("notificaciones_dashboard").insert(fila);
    if (error) console.error("[EMAIL_FALLIDO] Error al registrar aviso:", error.message);
    return !error;
  } catch (err) {
    console.error("[EMAIL_FALLIDO] Excepción registrando aviso:", (err as Error)?.message || err);
    return false;
  }
}

// Las plantillas de correo (tplSolicitudRecibida, tplSolicitudNoProcesada)
// y `escapeHtml` viven en `./plantillas.ts` (importado arriba),
// parametrizadas por `DatosNegocio` en vez de tener "Casa Tomás" escrito a
// fuego — ver la cabecera de ese fichero para el porqué (una reserva puede
// ser de Casa Tomás o de Touza). tplConfirmaAsistencia y
// tplSinDisponibilidad se retiraron el 2026-09-30 con `/notificar-estado`.

// ------------------------------------------------------------
// PÁGINAS HTML (respuesta directa al navegador, no emails)
// ------------------------------------------------------------

// Bug corregido: mostraba "Elena Morales", "2025-11-16", "21:00", "7
// comensales" escritos a fuego. Ahora los datos vienen de una lectura
// fresca de `reservas` (ver handleConfirmar), no de la query string.
function pageReservaConfirmada(nombre: string, fecha: string, hora: string, comensales: number): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Reserva confirmada - Casa Tomás Crevillente</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; font-family: Arial, sans-serif; background: linear-gradient(135deg, #f5f5f5, #e8efe4); display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #ffffff; border-radius: 10px; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08); max-width: 480px; width: 100%; padding: 32px 28px; text-align: center; }
    .check-circle { width: 60px; height: 60px; border-radius: 50%; border: 3px solid #2c7a33; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; font-size: 32px; color: #2c7a33; }
    h1 { margin: 12px 0 8px; font-size: 24px; color: #333; }
    p { margin: 6px 0; color: #555; line-height: 1.5; font-size: 14px; }
    .details { margin-top: 18px; padding: 14px 16px; background: #f7faf7; border-radius: 8px; text-align: left; font-size: 14px; color: #333; }
    .details b { color: #2c7a33; }
    .footer { margin-top: 22px; font-size: 12px; color: #777; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check-circle">✓</div>
    <h1>¡Reserva confirmada!</h1>
    <p>Gracias, <b>${escapeHtml(nombre)}</b>. Hemos confirmado tu reserva en <b>Casa Tomás Crevillente</b>.</p>
    <div class="details">
      <p><b>Fecha:</b> ${escapeHtml(fecha)}</p>
      <p><b>Hora:</b> ${escapeHtml(hora.slice(0, 5))}</p>
      <p><b>Número de comensales:</b> ${comensales}</p>
    </div>
    <p class="footer">Si necesitas modificar o cancelar la reserva, ponte en contacto con nosotros.<br />¡Te esperamos!</p>
  </div>
</body>
</html>`;
}

// Bug corregido: la página original interpolaba $json.query.* (nombre,
// fecha, hora, comensales) SIN escapar y SIN comprobar que la reserva
// existiera — un enlace manipulado podía mostrar datos falsos o inyectar
// HTML. Ahora todo sale de una lectura fresca de la reserva por el id
// del token, escapada.
function pageCancelarPreview(nombre: string, fecha: string, hora: string, comensales: number, ejecutarUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Cancelar Reserva - Casa Tomás Crevillente</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: linear-gradient(135deg, #f5f5f5, #e0e0e0); display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #ffffff; border-radius: 10px; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08); max-width: 480px; width: 100%; padding: 32px 28px; text-align: center; border-top: 6px solid #e04f5f; }
    .icon-warning { width: 60px; height: 60px; border-radius: 50%; background-color: #fff5f5; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; font-size: 32px; color: #e04f5f; font-weight: bold; }
    h1 { margin: 12px 0 8px; font-size: 24px; color: #333; }
    p { margin: 6px 0; color: #555; line-height: 1.5; font-size: 14px; }
    .details { margin-top: 20px; padding: 16px; background: #f9f9f9; border-left: 4px solid #e04f5f; border-radius: 4px; text-align: left; font-size: 14px; color: #333; }
    .details p { margin: 4px 0; }
    .btn-container { margin-top: 30px; display: flex; flex-direction: column; gap: 10px; }
    .btn-delete { display: block; width: 100%; padding: 14px 0; background-color: #e04f5f; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px; border: none; cursor: pointer; box-sizing: border-box; }
    .btn-delete:hover { background-color: #c03947; }
    .btn-keep { display: block; width: 100%; padding: 14px 0; background-color: transparent; color: #777; text-decoration: none; border-radius: 4px; font-size: 14px; border: 1px solid #ddd; box-sizing: border-box; }
    .btn-keep:hover { background-color: #f5f5f5; color: #333; }
    .footer { margin-top: 22px; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-warning">!</div>
    <h1>¿Quieres cancelar tu reserva?</h1>
    <p>Estás a punto de cancelar la siguiente reserva en <b>Casa Tomás Crevillente</b>. Esta acción no se puede deshacer.</p>
    <div class="details">
      <p><b>Nombre:</b> ${escapeHtml(nombre)}</p>
      <p><b>Fecha:</b> ${escapeHtml(fecha)}</p>
      <p><b>Hora:</b> ${escapeHtml(hora.slice(0, 5))}</p>
      <p><b>Comensales:</b> ${comensales}</p>
    </div>
    <div class="btn-container">
      <a href="${ejecutarUrl}" class="btn-delete">Sí, cancelar reserva definitivamente</a>
      <a href="javascript:window.close()" class="btn-keep">No, mantener mi reserva</a>
    </div>
    <p class="footer">Si tienes dudas, llámanos al ${RESTAURANTE_TEL_TEXTO}.</p>
  </div>
</body>
</html>`;
}

// Estática (sin datos dinámicos), igual que el original. Se corrigió la
// frase "tus datos eliminados de esta reserva": no es cierto, solo se
// marca estado='cancelada', no se borra nada.
function pageCancelada(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Reserva Cancelada - Casa Tomás Crevillente</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: linear-gradient(135deg, #f5f5f5, #e0e0e0); display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #ffffff; border-radius: 10px; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08); max-width: 480px; width: 100%; padding: 40px 28px; text-align: center; border-top: 6px solid #394247; }
    .icon-check { width: 70px; height: 70px; border-radius: 50%; border: 3px solid #394247; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px auto; font-size: 36px; color: #394247; font-weight: bold; }
    h1 { margin: 12px 0 15px; font-size: 26px; color: #333; }
    p { margin: 10px 0; color: #555; line-height: 1.6; font-size: 16px; }
    .message-box { margin-top: 25px; padding: 20px; background: #f4f4f4; border-radius: 8px; color: #666; font-size: 15px; }
    .footer { margin-top: 30px; font-size: 13px; color: #999; }
    .btn-close { display: inline-block; margin-top: 20px; padding: 10px 20px; color: #888; text-decoration: none; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    .btn-close:hover { background-color: #f9f9f9; color: #333; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-check">✓</div>
    <h1>Operación realizada</h1>
    <p>La reserva ha sido cancelada correctamente.</p>
    <div class="message-box">Tu mesa ha quedado liberada.</div>
    <p>Ya puedes cerrar esta ventana o salir de la página.</p>
    <p class="footer">Esperamos verte pronto en <b>Casa Tomás Crevillente</b>.</p>
    <a href="javascript:window.close()" class="btn-close">Cerrar ventana</a>
  </div>
</body>
</html>`;
}

// Página nueva: no existía en el flujo original (que no contemplaba
// tokens caducados/reutilizados). Hace falta porque ahora confirmar y
// cancelar SÍ pueden rechazar un enlace.
function pageTokenInvalido(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Enlace no válido - Casa Tomás Crevillente</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: linear-gradient(135deg, #f5f5f5, #e0e0e0); display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #ffffff; border-radius: 10px; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08); max-width: 480px; width: 100%; padding: 32px 28px; text-align: center; border-top: 6px solid #9B948E; }
    .icon { width: 60px; height: 60px; border-radius: 50%; background-color: #F0EDEA; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; font-size: 30px; color: #6B6560; }
    h1 { margin: 12px 0 8px; font-size: 22px; color: #333; }
    p { margin: 6px 0; color: #555; line-height: 1.6; font-size: 14px; }
    .footer { margin-top: 22px; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">i</div>
    <h1>Este enlace ya no es válido</h1>
    <p>Puede que ya se haya usado o que haya caducado.</p>
    <p>Si necesitas ayuda con tu reserva, llámanos al <a href="tel:${RESTAURANTE_TEL_HREF}">${RESTAURANTE_TEL_TEXTO}</a>.</p>
    <p class="footer">Casa Tomás · Crevillente</p>
  </div>
</body>
</html>`;
}

// ============================================================
// ACCIÓN: disponibilidad
// ============================================================
// Antes esto devolvía la ocupación y los turnos EN CRUDO, sin aplicar
// ninguna regla: el cliente de la web recibía las filas de
// `configuracion_turnos` y se las apañaba para deducir qué horas ofrecer.
// El resultado era que el visitante NO veía las horas que el sistema
// habría decidido ofrecerle (y `ReservationForm.tsx` acabó con su propia
// copia divergente de la regla, con `secondaryOffsets = [15, 45]`).
//
// Ahora el cálculo lo hace `_shared/disponibilidad.ts`, el MISMO módulo
// que usa el panel. Esta función solo lee de la base de datos y traduce
// el resultado al contrato del array plano.
//
// FORMA DE LA RESPUESTA — en éxito SIEMPRE un ARRAY PLANO de nivel
// superior, nunca un objeto (n8n respondía con un array y el consumidor
// hace `rawData.map(...)`). Cada elemento lleva un discriminador `kind`:
//
//   kind: "meta"        -> 1 elemento, SIEMPRE el primero.
//   kind: "periodo"     -> 0..n, fila de `configuracion_turnos` aplicable.
//   kind: "ocupacion"   -> 0..n, una hora con reservas vivas ese día.
//   kind: "hueco"       -> 0..n, NUEVO. Una hora YA DECIDIDA por el motor.
//   kind: "descartado"  -> 0..n, NUEVO. Una hora que NO se ofrece, con el
//                          motivo. Es diagnóstico: el frontend puede
//                          ignorarlo entero.
//
// COMPATIBILIDAD: `meta`, `periodo` y `ocupacion` conservan todos los
// campos que ya tenían y su mismo significado; solo se les AÑADEN campos.
// `clasificarDisponibilidad` (casa-tomas-story) sigue funcionando sin
// tocar nada. Lo que debería cambiar el frontend es dejar de recalcular
// las horas y limitarse a pintar los `kind:"hueco"`.
//
// En error (4xx/5xx) el cuerpo sigue siendo `{ ok:false, error }`: hay
// que comprobar `response.ok` ANTES de mapear.
// GET /salud — sonda de keep-warm (CT-REM-FN-07c). Sin BD y sin secretos: solo
// mantiene caliente el isolate de la función para evitar el arranque en frío
// (~22 s en la 1.ª petición tras un rato de inactividad). La llama el cron
// `reservas-web-keep-warm` (migración 20261119120000). No revela nada.
function handleSalud(): Response {
  return json({ ok: true, servicio: "reservas-web" });
}

async function handleDisponibilidad(req: Request): Promise<Response> {
  if (!checkSharedSecret(req)) return json({ ok: false, error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const fecha = typeof body?.fecha === "string" ? body.fecha : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json({ ok: false, error: "fecha_invalida" }, 400);

  // CT-REM-FN-07b: limitador por IP de /disponibilidad (solo lectura). Tras
  // validar la fecha y ANTES de cualquier consulta a la BD: una consulta
  // throttled no toca la BD. FALLA EN ABIERTO a propósito —al revés que
  // /crear—: disponibilidad es el corazón del flujo de reserva, así que si el
  // limitador no está disponible la consulta se SIRVE igual; solo se bloquea
  // cuando dice "denegado" (se superó el límite por IP/hora o el diario).
  const cupoDisponibilidad = await reservarCupoDisponibilidad(supabase, req, IP_SALT);
  if (cupoDisponibilidad.estado === "denegado") {
    console.warn(`[reservas-web] /disponibilidad bloqueada por el limitador (${cupoDisponibilidad.motivo})`);
    const r = respuestaDemasiadasSolicitudes(RESTAURANTE_TEL_TEXTO);
    return json(r.cuerpo, r.status);
  }

  const comensalesRaw = parseInt(String(body?.numero_comensales ?? body?.comensales ?? ""), 10);
  const comensales = Number.isFinite(comensalesRaw) && comensalesRaw > 0 ? comensalesRaw : 1;
  const espacioId = typeof body?.espacio_id === "string" && body.espacio_id ? body.espacio_id : null;

  // `select("*")` a propósito: el motor acepta tanto las columnas antiguas
  // como `niveles_escalera`/`ocultar_nivel_anterior`, y así la función no
  // hay que volver a desplegarla cuando se aplique la migración.
  const { data: turnosRaw, error: errTurnos } = await supabase
    .from("configuracion_turnos")
    .select("*")
    .eq("activo", true);
  if (errTurnos) {
    console.error("[DISPONIBILIDAD] configuracion_turnos:", errTurnos.message);
    return json({ ok: false, error: "error_configuracion" }, 500);
  }

  // `caracteristicas` (no solo `capacidad_maxima`): hace falta para saber
  // la marca de CADA espacio (`caracteristicas->>'marca'`) y, si viene
  // `espacio_id`, para resolver la marca de la consulta sin una segunda
  // consulta — ver `resolverMarca` más abajo.
  const { data: espaciosRaw, error: errEspacios } = await supabase
    .from("espacios_reserva")
    .select("id, capacidad_maxima, caracteristicas")
    .eq("activa", true);
  if (errEspacios) {
    console.error("[DISPONIBILIDAD] espacios_reserva:", errEspacios.message);
    return json({ ok: false, error: "error_configuracion" }, 500);
  }

  // Marca (Casa Tomás / Touza) de ESTA consulta de disponibilidad — misma
  // prioridad que `resolverMarca` usa en `handleCrear` (ver plantillas.ts):
  // 1) `body.marca` explícita; 2) la marca del espacio pedido, si se manda
  // `espacio_id`; 3) por defecto `NEGOCIO_POR_DEFECTO` ('casa_tomas').
  // De las dos webs, solo la de Casa Tomás (ReservationForm.tsx) llama a
  // esta acción, y sin `marca` ni `espacio_id`: cae siempre en el 3. La de
  // Touza (Reservado.tsx) no consulta disponibilidad; sí manda
  // `marca: "touza"`, pero solo a `/crear`. Una consulta que resuelva Touza
  // recibe el 409 `touza_sin_reservas` de justo debajo. Sin este paso, el
  // aforo devuelto seguiría sumando TODOS los espacios activos sin
  // distinguir negocio (el bug 150->170 que motiva este cambio).
  const espacioConsultado = espacioId
    ? (espaciosRaw || []).find((e: { id: string; caracteristicas: Record<string, unknown> | null }) => e.id === espacioId)
    : null;
  const marca: Marca = resolverMarca({
    marcaExplicita: body?.marca,
    marcaEspacio: espacioConsultado?.caracteristicas?.marca,
    notasCliente: null,
  });

  // Touza NO admite reservas (2026-10-01): tampoco se le calcula
  // disponibilidad. Con la marca ya resuelta (explícita o la del espacio
  // pedido) y antes de leer la ocupación. Ver `rechazoTouzaSinReservas` en
  // reglas.ts.
  const rechazoTouza = rechazoTouzaSinReservas(marca);
  if (rechazoTouza) return json(rechazoTouza.cuerpo, rechazoTouza.status);

  // Ocupación SIEMPRE desde `reservas`, nunca desde `vista_ocupacion`:
  // en producción 724 de sus 784 filas son huérfanas. Mismo criterio que
  // el webhook telefónico y que el trigger `trg_validar_capacidad`.
  // `.eq("marca", marca)`: `reservas.marca` es `NOT NULL DEFAULT
  // 'casa_tomas'` (migración 20260922180000), así que esto ya equivale al
  // `COALESCE(marca, 'casa_tomas') = v_marca` del trigger sin tener que
  // repetirlo aquí — una reserva de la otra marca no debe contar en ESTE
  // aforo (por eso, no solo por el espacio, ver el porqué en
  // `_shared/disponibilidad.ts`, sección "AFORO POR NEGOCIO").
  const { data: reservasDia, error: errReservas } = await supabase
    .from("reservas")
    .select("hora, numero_comensales, espacio_id")
    .eq("fecha", fecha)
    .eq("marca", marca)
    .in("estado", ESTADOS_QUE_OCUPAN as unknown as string[]);
  if (errReservas) {
    console.error("[DISPONIBILIDAD] reservas:", errReservas.message);
    return json({ ok: false, error: "error_ocupacion" }, 500);
  }

  const config = await getReservationConfig();
  const turnosCerrados = await turnosCerradosDe(fecha);
  const capacidadTotal = sumarCapacidadPorMarca(
    (espaciosRaw || []).map((e: { capacidad_maxima: number; caracteristicas: Record<string, unknown> | null }) => ({
      capacidad_maxima: e.capacidad_maxima,
      marca: e.caracteristicas?.marca as string | undefined,
      privada: esCaracteristicaPrivada(e.caracteristicas),
    })),
    marca,
  );

  const resultado = calcularDisponibilidad({
    fecha,
    comensales,
    espacioId,
    configuraciones: (turnosRaw || []) as unknown as ConfiguracionTurnoInput[],
    reservas: (reservasDia || []) as unknown as ReservaOcupante[],
    // Las reservas en una sala privada (fuera de aforo) no ocupan turno.
    salasPrivadas: idsSalasPrivadas(espaciosRaw as Array<{ id: string; caracteristicas: unknown }> | null),
    capacidadTotal,
    // Salas cerradas por un evento: la web y el bot solo ofrecen las que quedan.
    salasCerradasPorEvento: await salasCerradasPorEventoDe(fecha, espaciosRaw as Array<{ id: string; capacidad_maxima: number; caracteristicas: unknown }> | null, marca),
    serviciosCerrados: turnosCerrados,
    ahora: ahoraEnMadrid(),
    politica: {
      // Desde el 10/11/2026 la web admite reservas para hoy (con el corte
      // horario), salvo 12:30-16:00, que va por teléfono (reglas.ts).
      permitirMismoDia: true,
      minutosCorte: config.minutos_corte_antes_servicio || 60,
      diasMaxAntelacion: config.dias_max_antelacion || 60,
      maxComensales: config.max_comensales_por_reserva || null,
    },
  });

  // --- `periodo`: las columnas EN CRUDO (compatibilidad) + lo resuelto ---
  const resueltoPorId = new Map(resultado.periodos.map((p) => [p.id, p]));
  const periodosOut = (turnosRaw as Array<Record<string, unknown>> | null || [])
    .filter((t) => resueltoPorId.has(String(t.id)))
    .map((t) => {
      const r = resueltoPorId.get(String(t.id))!;
      return {
        ...t,
        fecha,
        escalera: r.escalera,
        ocultar_nivel_anterior: r.ocultar_nivel_anterior,
        origen_escalera: r.origen_escalera,
        huecos_ofrecidos: r.huecos_ofrecidos,
        huecos_completos: r.huecos_completos,
        // `kind` va AL FINAL, después del spread, para que una columna
        // futura con ese nombre no pueda pisar el discriminador.
        kind: "periodo" as const,
      };
    });

  // --- `ocupacion`: misma forma de siempre (hora con segundos) ---
  const ocupacionOut = resultado.ocupacion.map((o) => ({
    kind: "ocupacion" as const,
    fecha,
    hora: `${o.hora}:00`,
    turno: o.turno,
    total_reservas: o.total_reservas,
    total_comensales: o.total_comensales,
    capacidad_maxima: resultado.aforo[o.turno].capacidad_maxima,
    capacidad_disponible: resultado.aforo[o.turno].disponible,
    porcentaje_ocupacion: resultado.aforo[o.turno].porcentaje,
    // NUEVO: ocupación de ESA hora concreta, no la del turno entero.
    porcentaje_hora: o.porcentaje_hora,
  }));

  // --- `hueco`: LO QUE HAY QUE PINTAR ---
  // Bloqueos solo de la web (reglas.ts): servicio bloqueado desde el panel y
  // «hoy 12:30-16:00 solo por teléfono». Esas horas salen de `hueco` y pasan
  // a `descartado` con su código, igual que las rechaza /crear.
  const fechaHoy = ahoraEnMadrid().fechaHoy;
  const turnosBloqueados = await turnosBloqueadosDe(fecha);
  const descartadosWeb: Array<Record<string, unknown>> = [];
  const huecosOut = resultado.huecos
    .filter((h) => {
      const motivoWeb = motivoHoraNoOfrecidaWeb(fecha, h.hora, fechaHoy, turnosBloqueados);
      if (!motivoWeb) return true;
      descartadosWeb.push({
        hora: h.hora,
        nivel: h.nivel,
        minutos_nivel: h.minutos_nivel,
        periodo: h.periodo,
        motivo: motivoWeb,
        detalle: `${h.hora} no se puede reservar online (${motivoWeb})`,
      });
      return false;
    })
    .map((h) => ({
      ...h,
      fecha,
      kind: "hueco" as const,
    }));

  // --- `descartado`: por qué NO se ofrece cada hora (diagnóstico) ---
  const descartadosOut = [...descartadosWeb, ...resultado.descartados].slice(0, 200).map((d) => ({
    ...d,
    fecha,
    kind: "descartado" as const,
  }));

  const meta = {
    kind: "meta" as const,
    fecha,
    // NUEVO: la marca (negocio) contra la que se ha calculado ESTE aforo
    // — ver resolución arriba. Puramente informativo (nadie lo consumía
    // antes de este campo), pero deja visible en la propia respuesta con
    // qué capacidad se ha comparado, para poder detectar en caliente un
    // desacuerdo entre lo que ve el cliente y lo que luego valida el
    // trigger (el mismo caso que motiva este cambio).
    marca,
    // `cerrado` conserva EXACTAMENTE su significado: el restaurante no abre
    // ese día (cero periodos). Un turno lleno NO es un día cerrado.
    cerrado: resultado.cerrado,
    motivo_cierre: resultado.motivoCierre,
    // NUEVO (2026-10-13): servicios sin reservas ese día ("comida" | "cena").
    // Con los dos, `cerrado = true` y `motivo_cierre = "cierre_reservas"`.
    servicios_cerrados: turnosCerrados,
    // NUEVO (2026-11-10): servicios bloqueados a la web desde el panel
    // ("comida" | "cena"); sus horas no salen como `hueco`.
    servicios_bloqueados: turnosBloqueados,
    aforo_turno: {
      comida: resultado.aforo.comida,
      cena: resultado.aforo.cena,
    },
    total_periodos: periodosOut.length,
    total_ocupacion: ocupacionOut.length,
    // NUEVOS
    dia_semana: resultado.diaSemana,
    comensales: resultado.comensales,
    reservable: resultado.reservable,
    motivo_no_reservable: resultado.motivoNoReservable,
    total_huecos: huecosOut.length,
    huecos_ofrecidos: huecosOut.filter((h) => h.ofrecido).length,
    huecos_completos: huecosOut.filter((h) => !h.ofrecido).length,
    // Configuración incoherente detectada (umbrales en desorden, periodos
    // que cruzan medianoche, franja 16:00-17:00…). El panel puede pintarlo.
    avisos: resultado.avisos,
  };

  return json([meta, ...periodosOut, ...ocupacionOut, ...huecosOut, ...descartadosOut]);
}

// ============================================================
// ACCIÓN: cierres
// ============================================================
// Para el calendario de la web: qué servicios NO admiten reservas en un
// rango. Cuerpo `{ desde, hasta }` (YYYY-MM-DD, máx. 120 días). Respuesta
// `{ ok: true, cierres: [{ fecha, turno }] }` — solo fecha y turno: el
// motivo de un cierre manual es interno y no sale a la web.
async function handleCierres(req: Request): Promise<Response> {
  if (!checkSharedSecret(req)) return json({ ok: false, error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const desde = typeof body?.desde === "string" ? body.desde : "";
  const hasta = typeof body?.hasta === "string" ? body.hasta : "";
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(desde) || !re.test(hasta) || hasta < desde) {
    return json({ ok: false, error: "rango_invalido" }, 400);
  }
  const dias = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(dias) || dias > 120) return json({ ok: false, error: "rango_demasiado_largo" }, 400);
  const cierres = await leerServiciosCerrados(desde, hasta);
  return json({ ok: true, cierres: cierres.map((c) => ({ fecha: c.fecha, turno: c.turno })) });
}

// ============================================================
// ACCIÓN: crear
// ============================================================
async function handleCrear(req: Request): Promise<Response> {
  if (!checkSharedSecret(req)) return json({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const nombre = typeof body?.nombre === "string" ? body.nombre.trim().slice(0, 200) : "";
  const fecha = typeof body?.fecha === "string" ? body.fecha : "";
  const hora = typeof body?.hora === "string" ? body.hora : "";
  const partySize = parseInt(String(body?.numero_comensales), 10);
  const notas = typeof body?.notas_cliente === "string" ? body.notas_cliente.slice(0, 500) : null;
  const salaNombreBody = typeof body?.sala === "string" ? body.sala : null;
  const espacioIdBody = typeof body?.espacio_id === "string" ? body.espacio_id : null;

  // Marca (Casa Tomás / Touza) — primera pasada, SIN tocar la BD: solo con
  // `body.marca` y con el sniff de `notas_cliente` (ver plantillas.ts,
  // resolverMarca). La web de Touza (Reservado.tsx) SÍ manda
  // `marca: "touza"` (y además el marcador de El Reservado en las notas):
  // sale Touza y se rechaza justo debajo con el 409 `touza_sin_reservas`.
  // La de Casa Tomás (ReservationForm.tsx) no manda `marca`: cae en la
  // marca por defecto, 'casa_tomas'. Vale para TODOS los rechazos de aquí
  // abajo — incluido el de blacklist, el más rápido — sin añadir una
  // consulta a `espacios_reserva` a un camino que hoy nunca la necesita (ni
  // Reservado.tsx ni ReservationForm.tsx mandan `espacio_id`/`sala`). Se
  // refina con el espacio, si lo hay, justo antes del INSERT — ver más
  // abajo — para la reserva que de verdad se guarda.
  const marcaTemprana: Marca = resolverMarca({ marcaExplicita: body?.marca, notasCliente: notas });

  // Touza NO admite reservas (2026-10-01; ver `rechazoTouzaSinReservas` en
  // reglas.ts). Lo PRIMERO tras saber la marca: antes de validar el
  // formulario y de cualquier lectura o escritura. La lista negra,
  // `grupo_grande`, los límites por teléfono/email y el INSERT registran una
  // solicitud o mandan un correo, y la web de Touza pintaría `grupo_grande`
  // como «Solicitud recibida» sin que nadie la atendiera.
  // Basta con `marcaTemprana`: la segunda pasada de `resolverMarca` (antes
  // del INSERT) solo puede dar Touza si esta ya lo daba, porque
  // `salaDelCliente` descarta el espacio en Casa Tomás.
  const rechazoTouza = rechazoTouzaSinReservas(marcaTemprana);
  if (rechazoTouza) return json(rechazoTouza.cuerpo, rechazoTouza.status);

  const negocioTemprano: DatosNegocio = NEGOCIOS[marcaTemprana];

  // reservas-sin-salas: en Casa Tomás la sala es interna y la web IGNORA la
  // que mande el cliente (la reserva queda sin sala y la asigna el personal).
  // En Touza se respeta: El Reservado es lo que se reserva. Ver reglas.ts.
  // Consecuencia aceptada: una petición cuya ÚNICA señal de Touza fuera un
  // espacio_id/sala (sin `marca` ni el marcador de El Reservado en las notas)
  // se trata como Casa Tomás. Ningún frontend manda hoy espacio_id ni sala.
  const { espacioId: espacioIdInput, salaNombre } = salaDelCliente(marcaTemprana, {
    espacioId: espacioIdBody,
    salaNombre: salaNombreBody,
  });

  if (!nombre) return json({ ok: false, error: "nombre_requerido" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json({ ok: false, error: "fecha_invalida" }, 400);
  if (!/^\d{2}:\d{2}$/.test(hora)) return json({ ok: false, error: "hora_invalida" }, 400);
  if (isNaN(partySize) || partySize < 1 || partySize > 100) return json({ ok: false, error: "numero_comensales_invalido" }, 400);

  const telefonoRaw = typeof body?.telefono === "string" ? body.telefono.trim() : "";
  const emailRaw = typeof body?.email === "string" ? body.email.trim() : "";
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) return json({ ok: false, error: "email_invalido" }, 400);
  if (telefonoRaw && !/^\d{9,15}$/.test(normalizePhone(telefonoRaw))) return json({ ok: false, error: "telefono_invalido" }, 400);

  // Casillas RGPD del formulario (ver reglas.ts). `acepta_condiciones` es
  // obligatoria: se rechaza aquí, con el resto de datos obligatorios y ANTES
  // de cualquier lectura o escritura — sin ella no se registra solicitud ni
  // se manda correo. El secret se lee en cada petición a propósito: cambiarlo
  // (`supabase secrets set RESERVAS_WEB_CONDICIONES_OBLIGATORIAS=false`)
  // surte efecto sin redesplegar.
  const consentimientos = leerConsentimientos(body);
  const rechazoCondiciones = rechazoCondicionesNoAceptadas(
    consentimientos,
    condicionesObligatorias(Deno.env.get("RESERVAS_WEB_CONDICIONES_OBLIGATORIAS")),
  );
  if (rechazoCondiciones) return json(rechazoCondiciones.cuerpo, rechazoCondiciones.status);

  // CT-REM-FN-07: limitador persistente por IP (HMAC) y cupo global diario,
  // en SQL y atómico (reservas_web_reservar_cupo). Va justo después de las
  // validaciones que no tocan la BD y ANTES de cualquier lectura o escritura:
  // una solicitud bloqueada no registra solicitud pendiente, ni notificación,
  // ni reserva, ni manda correo. FALLA EN CERRADO: si la RPC no existe o
  // falla, 503 sin efecto.
  const cupo = await reservarCupoCrear(supabase, req, IP_SALT);
  if (cupo.estado === "no_disponible") {
    console.error("[reservas-web] limitador no disponible: se rechaza /crear (fail-closed)");
    const r = respuestaLimitadorNoDisponible(RESTAURANTE_TEL_TEXTO);
    return json(r.cuerpo, r.status);
  }
  if (cupo.estado === "denegado") {
    console.warn(`[reservas-web] /crear bloqueada por el limitador (${cupo.motivo})`);
    const r = respuestaDemasiadasSolicitudes(RESTAURANTE_TEL_TEXTO);
    return json(r.cuerpo, r.status);
  }

  const config = await getReservationConfig();
  const maxComensales = config.max_comensales_por_reserva || 12;
  const minComensales = config.min_comensales_por_reserva || 1;
  const maxPorTelDia = config.max_reservas_por_telefono_dia || 2;

  let telefono: string | null = null;
  if (telefonoRaw) {
    const norm = normalizePhone(telefonoRaw);
    telefono = norm.length === 9 ? `+34${norm}` : `+${norm}`;
  }
  const email = emailRaw || null;

  if (config.telefono_obligatorio && !telefono) return json({ ok: false, error: "telefono_requerido" }, 400);
  if (config.email_obligatorio && !email) return json({ ok: false, error: "email_requerido" }, 400);

  const datosSolicitud = { nombre, telefono, email, fecha, hora, comensales: partySize, notas, marca: marcaTemprana, consentimientos };
  // B-3: antes esto devolvía SIEMPRE HTTP 200. El frontend solo mira
  // `response.ok` y nunca lee el cuerpo, así que un cliente RECHAZADO veía
  // el diálogo de "¡Reserva confirmada!" a la vez que recibía el email de
  // rechazo que se manda dos líneas más abajo. Ahora `status` es
  // OBLIGATORIO en cada llamada y el 200 queda reservado al éxito real:
  //   403 -> blacklist (mensaje neutro, no se le revela el motivo)
  //   422 -> regla de negocio que el cliente PUEDE corregir en el formulario
  //   409 -> conflicto con el estado actual que el cliente NO puede corregir
  // El cuerpo NO cambia: sigue llevando `motivo` y `mensaje` legibles, y
  // el envío de email y el registro de solicitud pendiente son idénticos.
  const avisar = async (motivo: string, descripcion: string, mensajeCliente: string, status: number, log = true) => {
    if (log) await registrarSolicitudPendiente({ ...datosSolicitud, motivo, descripcion });
    // ESTE correo NO se puede delegar en `emails-reserva` ni registrar en
    // `envios_email_reserva`: aqui todavia NO existe fila en `reservas` (el
    // rechazo ocurre antes del INSERT, y en blacklist no llega a haberla
    // nunca), y `envios_email_reserva.reserva_id` es NOT NULL con FK a
    // `reservas`. Hacerlo nullable tampoco valdria: el indice unico
    // `uq_envio_email_reserva_activo (reserva_id, tipo_email)` dejaria de
    // deduplicar en cuanto `reserva_id` fuese NULL (en Postgres los NULL son
    // distintos entre si en un indice unico). Y `/notificar` deriva el tipo
    // del ESTADO de una reserva que aqui no hay.
    // Es exactamente el mismo caso —y la misma decision— que
    // `emails-reserva/propuesta-solicitud.ts` ya documenta para la propuesta
    // de una solicitud: sin fila, sin reintento automatico; la visibilidad la
    // da el aviso de `notificaciones_dashboard` de aqui debajo.
    // Lo unico que cambia es que el envio deja de bloquear la respuesta.
    if (email) {
      await enSegundoPlano(
        (async () => {
          // CT-REM-FN-07: como mucho 1 correo de rechazo por dirección cada
          // 24 h (la dirección no está verificada: sin esto, un bucle
          // convertía al restaurante en emisor de correo hacia terceros).
          if (!(await puedeEnviarCorreoRechazo(supabase, email))) {
            console.log("[reservas-web] correo de rechazo omitido: ya se envió uno a esa dirección en 24 h (o el tope no está disponible)");
            return;
          }
          const resultadoEmail = await sendEmail(
            email,
            `Estado de reserva ${negocioTemprano.nombre}`,
            tplSolicitudNoProcesada(negocioTemprano, nombre, fecha, hora, partySize),
          );
          if (!resultadoEmail.ok) {
            await avisarEmailFallido({
              contexto: "solicitud no procesada",
              negocio: negocioTemprano,
              nombre,
              fecha,
              hora,
              reservaId: null,
              error: resultadoEmail.error,
            });
          }
        })(),
        "solicitud no procesada",
      );
    }
    return json({ ok: false, motivo, mensaje: mensajeCliente }, status);
  };

  // Cierres de reservas: ese día/servicio no se cogen reservas. Sin
  // solicitud pendiente ni correo: no es algo que el personal tenga que
  // gestionar, el restaurante está cerrado.
  const turnosCerradosCrear = await turnosCerradosDe(fecha);
  if (turnosCerradosCrear.includes(turnoDeHoraServicio(hora))) {
    const cuando = textoTurnosCerrados(turnosCerradosCrear);
    return json(
      {
        ok: false,
        motivo: "restaurante_cerrado",
        error: "restaurante_cerrado",
        mensaje: `Ese día el restaurante está cerrado ${cuando} y no admite reservas. Elige otra fecha.`,
        servicios_cerrados: turnosCerradosCrear,
      },
      422,
    );
  }

  // Bloqueos solo de la web (reglas.ts), sin solicitud pendiente ni correo,
  // igual que el cierre: hoy 12:30-16:00 solo por teléfono (ANTES del
  // `reserva_hoy` genérico, para dar el mensaje concreto), servicio bloqueado
  // desde el panel y las condiciones del menú del día.
  const rechazoMismoDia = rechazoMismoDiaTelefono(fecha, hora, ahoraEnMadrid().fechaHoy);
  if (rechazoMismoDia) return json(rechazoMismoDia.cuerpo, rechazoMismoDia.status);
  const rechazoBloqueo = rechazoServicioBloqueado(hora, await turnosBloqueadosDe(fecha));
  if (rechazoBloqueo) return json(rechazoBloqueo.cuerpo, rechazoBloqueo.status);
  const menuDelDia = leerMenuDelDia(body);
  if (menuDelDia) {
    // Sala que pide el cliente (aunque en Casa Tomás no se guarde): por nombre
    // o, si manda `espacio_id`, el nombre de ese espacio.
    let salaPedida: string | null = salaNombreBody && salaNombreBody.trim() ? salaNombreBody : null;
    if (!salaPedida && espacioIdBody) {
      const { data: espacioPedido } = await supabase.from("espacios_reserva").select("nombre").eq("id", espacioIdBody).maybeSingle();
      salaPedida = (espacioPedido?.nombre as string | undefined) ?? espacioIdBody;
    }
    const rechazoMenu = rechazoMenuDelDia(true, fecha, hora, salaPedida);
    if (rechazoMenu) return json(rechazoMenu.cuerpo, rechazoMenu.status);
  }

  // Blacklist — igual que fnCreateReservation: NO se registra en
  // solicitudes_pendientes (ya está fichado) y el motivo devuelto al
  // cliente es genérico, para no confirmarle que está en la lista.
  if (await verificarBlacklist(telefono, email)) {
    return await avisar("no_disponible", "Blacklist.", "No ha sido posible formalizar la solicitud.", 403, false);
  }

  // Comensales fuera de rango
  if (partySize < minComensales || partySize > maxComensales) {
    if (partySize > maxComensales) {
      return await avisar(
        "grupo_grande",
        `Quiso reservar para ${partySize} personas (máximo automático: ${maxComensales}).`,
        `Para más de ${maxComensales} personas contacta directamente con el restaurante.`,
        422
      );
    }
    // Por debajo del mínimo: input bien formado que incumple una regla de
    // negocio que el cliente puede corregir -> 422, no 400. Se añade
    // `mensaje` (antes no había ninguno) para que el frontend tenga algo
    // que mostrar, igual que en el resto de rechazos.
    return json(
      {
        ok: false,
        error: "numero_comensales_fuera_de_rango",
        mensaje: `Las reservas web son para un mínimo de ${minComensales} y un máximo de ${maxComensales} personas.`,
        min: minComensales,
        max: maxComensales,
      },
      422
    );
  }

  // Fecha: "hoy" primero (con aviso), luego validación genérica (sin aviso)
  const hoyRef = hoyEnMadrid();
  const reservaDateRef = new Date(fecha + "T00:00:00Z");
  const diffDiasRef = Math.ceil((reservaDateRef.getTime() - hoyRef.getTime()) / (1000 * 60 * 60 * 24));
  // Hoy ya se admite (10/11/2026): lo frenan el corte horario y la franja
  // 12:30-16:00 solo por teléfono (más arriba).
  // Fecha pasada y fecha demasiado lejana: la fecha es válida y parseable,
  // lo que incumple es una regla de negocio corregible -> 422, no 400.
  if (diffDiasRef < 0) {
    return json({ ok: false, error: "fecha_pasada", mensaje: "La fecha seleccionada ya ha pasado." }, 422);
  }
  const diasMaxAntelacion = config.dias_max_antelacion || 60;
  if (diffDiasRef > diasMaxAntelacion) {
    return json(
      {
        ok: false,
        error: "fecha_demasiado_lejana",
        mensaje: `Solo se pueden reservar fechas con un máximo de ${diasMaxAntelacion} días de antelación.`,
        dias_max: diasMaxAntelacion,
      },
      422
    );
  }

  // Corte horario (con aviso)
  const minutosCorte = config.minutos_corte_antes_servicio || 60;
  const fechaHoraRef = parseFechaHoraMadrid(fecha, hora);
  const diffMinRef = (fechaHoraRef.getTime() - Date.now()) / (1000 * 60);
  if (diffMinRef < minutosCorte) {
    return await avisar("corte_horario", `Reserva con menos de ${minutosCorte} minutos de antelación.`, `Las reservas deben hacerse con al menos ${minutosCorte} minutos de antelación.`, 422);
  }

  // Rate limit por teléfono
  if (telefono) {
    const normPhone = normalizePhone(telefono);
    const variantes = Array.from(new Set([telefono, normPhone, `+34${normPhone}`].filter(Boolean)));
    const { data: existentesTel } = await supabase
      .from("reservas")
      .select("id")
      .in("telefono", variantes)
      .eq("fecha", fecha)
      .in("estado", ["pendiente", "verificada", "confirmada"]);
    if ((existentesTel || []).length >= maxPorTelDia) {
      return await avisar("max_reservas_telefono", `Ya tiene ${maxPorTelDia} reserva(s) activas para ${fecha}.`, "Ya hay reservas activas con este teléfono para esa fecha.", 409);
    }
  }
  // Rate limit por email
  if (email && config.max_reservas_por_email_dia) {
    const { data: existentesEmail } = await supabase
      .from("reservas")
      .select("id")
      .eq("email", email)
      .eq("fecha", fecha)
      .in("estado", ["pendiente", "verificada", "confirmada"]);
    if ((existentesEmail || []).length >= config.max_reservas_por_email_dia) {
      return await avisar("max_reservas_email", `Ya tiene el máximo de reservas por email para ${fecha}.`, "Ya hay reservas activas con este email para esa fecha.", 409);
    }
  }

  // La hora tiene que ser UNA DE LAS QUE EL MOTOR OFRECE.
  // Sin esto, `/crear` aceptaba cualquier `hora` enviada a mano: una
  // petición directa con "03:15" entraba igual, y toda la escalera de
  // niveles (que solo aplica la web al pintar) quedaba de adorno.
  //
  // Se calcula SIN `ahora` y SIN política de fechas a propósito: "hoy",
  // corte horario y fecha pasada/lejana ya se han rechazado arriba con
  // mensajes mejores, y volver a juzgarlos aquí los taparía. Tampoco se
  // juzga el aforo: de eso va la comprobación siguiente.
  try {
    const [{ data: turnosCrear }, { data: espaciosCrear }, { data: reservasCrear }] = await Promise.all([
      supabase.from("configuracion_turnos").select("*").eq("activo", true),
      // `caracteristicas` para poder filtrar por marca — ver `capacidadTotal`
      // más abajo. `marcaTemprana` (resuelta arriba, sin tocar la BD) es la
      // mejor señal disponible en este punto: el espacio (si lo hubiera)
      // todavía no se ha resuelto, eso pasa más abajo, justo antes del
      // INSERT. Hoy da igual: ni Reservado.tsx ni ReservationForm.tsx
      // mandan `espacio_id`, así que `marcaTemprana` y la `marca` final
      // siempre coinciden en producción.
      supabase.from("espacios_reserva").select("id, capacidad_maxima, caracteristicas").eq("activa", true),
      supabase
        .from("reservas")
        .select("hora, numero_comensales, espacio_id")
        .eq("fecha", fecha)
        .eq("marca", marcaTemprana)
        .in("estado", ESTADOS_QUE_OCUPAN as unknown as string[]),
    ]);

    const disponibilidad = calcularDisponibilidad({
      fecha,
      comensales: partySize,
      espacioId: espacioIdInput,
      configuraciones: (turnosCrear || []) as unknown as ConfiguracionTurnoInput[],
      reservas: (reservasCrear || []) as unknown as ReservaOcupante[],
      salasPrivadas: idsSalasPrivadas(espaciosCrear as Array<{ id: string; caracteristicas: unknown }> | null),
      capacidadTotal: sumarCapacidadPorMarca(
        (espaciosCrear || []).map((e: { capacidad_maxima: number; caracteristicas: Record<string, unknown> | null }) => ({
          capacidad_maxima: e.capacidad_maxima,
          marca: e.caracteristicas?.marca as string | undefined,
          privada: esCaracteristicaPrivada(e.caracteristicas),
        })),
        marcaTemprana,
      ),
      salasCerradasPorEvento: await salasCerradasPorEventoDe(
        fecha,
        espaciosCrear as Array<{ id: string; capacidad_maxima: number; caracteristicas: unknown }> | null,
        marcaTemprana,
      ),
      serviciosCerrados: turnosCerradosCrear,
      ahora: null,
    });

    const validacion = validarHoraOfrecida(disponibilidad, hora);
    if (!validacion.ok) {
      return await avisar(
        validacion.motivo || "sin_disponibilidad",
        validacion.detalle || `Hora ${hora} no ofrecida el ${fecha}.`,
        validacion.mensaje || "No queda disponibilidad para esa fecha y hora.",
        422,
      );
    }
    if (validacion.indeterminado) {
      console.warn("[CREAR] Sin configuracion_turnos legible: no se valida la hora, decide el trigger.");
    }
  } catch (err) {
    // Fallo leyendo la configuración: NO se bloquea la reserva. El trigger
    // `trg_validar_capacidad` sigue siendo la última palabra sobre el aforo.
    console.error("[CREAR] No se pudo validar la hora contra el motor:", (err as Error)?.message || err);
  }

  // Aforo (mismo criterio que el trigger `trg_validar_capacidad`; se
  // anticipa aquí para dar una respuesta clara, no sustituye al trigger).
  // `marcaTemprana`: mismo razonamiento que en el bloque de arriba.
  const { espacios, capacidadTotal, ocupacionTotal } = await getEspaciosConOcupacion(fecha, hora, marcaTemprana);
  const disponibleGlobal = ocupacionTotal + partySize <= capacidadTotal;
  // Casa Tomás: solo el aforo del turno (un grupo de 60 entra aunque ninguna
  // sala tenga 60). Touza: además, que quepa en un espacio. Ver reglas.ts.
  if (rechazarPorSala(marcaTemprana, disponibleGlobal, contarEspaciosQueCaben(espacios, partySize))) {
    return await avisar(
      "sin_disponibilidad",
      `Sin hueco el ${fecha} a las ${hora} para ${partySize} personas. Capacidad: ${capacidadTotal}, ocupación: ${ocupacionTotal}.`,
      "No queda disponibilidad para esa fecha y hora.",
      409
    );
  }

  // Espacio opcional por nombre o id — si no se indica se deja sin asignar
  // (igual que el canal telefónico: el staff lo asigna presencialmente).
  // Fix de porting: el n8n original insertaba en una columna `sala_id` que
  // NO existe en `reservas` (la columna real es `espacio_id`) — con el
  // formulario actual, que ya no envía `sala`, esa reserva quedaba sin
  // espacio de todos modos, así que aquí simplemente se hace explícito.
  let espacioId: string | null = espacioIdInput;
  // `caracteristicasEspacio` alimenta el punto 2 de `resolverMarca` (ver
  // plantillas.ts): hoy siempre queda `null` en la práctica porque ningún
  // frontend manda `espacio_id`/`sala` todavía, pero en cuanto lo hagan
  // (p.ej. tras aplicar `20260922150000_espacio_el_reservado_touza.sql`,
  // que ya etiqueta 'El Reservado' con `caracteristicas.marca = "touza"`)
  // empieza a funcionar sin tocar este fichero otra vez.
  let caracteristicasEspacio: unknown = null;
  if (!espacioId && salaNombre) {
    const { data: espacio } = await supabase
      .from("espacios_reserva")
      .select("id, caracteristicas")
      .eq("nombre", salaNombre)
      .eq("activa", true)
      .maybeSingle();
    if (!espacio) return json({ ok: false, error: "espacio_invalido" }, 400);
    espacioId = espacio.id as string;
    caracteristicasEspacio = espacio.caracteristicas;
  } else if (espacioId) {
    const { data: espacio } = await supabase.from("espacios_reserva").select("caracteristicas").eq("id", espacioId).maybeSingle();
    caracteristicasEspacio = espacio?.caracteristicas ?? null;
  }

  // Segunda (y última) pasada de `resolverMarca`, ahora con la señal del
  // espacio si la hay. `marcaTemprana`/`negocioTemprano` (arriba) ya sirvió
  // para los rechazos anteriores; esta es la que se GUARDA en la fila y la
  // autoritativa para todo lo que venga después (el correo de 'propuesta'
  // que manda emails-reserva, y confirmar/cancelar, leen
  // `reserva.marca`; no vuelven a derivarla).
  //
  // Ya no se construye aquí un `negocio` a partir de esta marca: lo único
  // que lo usaba era el correo de "solicitud recibida", que ha dejado de
  // mandarse desde este alta (ver el bloque de abajo).
  const marca: Marca = resolverMarca({
    marcaExplicita: body?.marca,
    marcaEspacio: (caracteristicasEspacio as Record<string, unknown> | null)?.marca,
    notasCliente: notas,
  });

  const filaReserva: Record<string, unknown> = {
    nombre,
    telefono,
    email,
    fecha,
    hora,
    numero_comensales: partySize,
    notas_cliente: notas,
    estado: "pendiente",
    espacio_id: espacioId,
    canal: "web",
    en_blacklist: false,
    importante: false,
    marca,
    // Prueba de consentimiento (RGPD art. 7.1), INMUTABLE por reserva. La
    // fecha del consentimiento al newsletter es `created_at` de esta misma
    // fila; la de la aceptación de las condiciones va en su propia columna
    // porque, con el interruptor de transición apagado, puede faltar.
    // Solo con el doble opt-in activo (ver estadoDobleOptin / reglas.ts): si
    // no, el trigger antiguo suscribiría el email sin verificarlo.
    consentimiento_newsletter: consentimientos.consentimientoNewsletter
      ? consentimientoNewsletterParaGuardar(consentimientos, await estadoDobleOptin())
      : false,
    condiciones_aceptadas_at: consentimientos.aceptaCondiciones ? new Date().toISOString() : null,
  };
  // Solo si es true: con false manda el DEFAULT de la columna, y así una
  // reserva normal no se cae si la función sale antes que la migración
  // 20261122100000.
  if (menuDelDia) filaReserva.menu_del_dia = true;

  let { data: inserted, error: insertError } = await supabase
    .from("reservas")
    .insert(filaReserva)
    .select("id")
    .single();

  // Red de seguridad de despliegue: si la función sale ANTES de aplicar la
  // migración 20261003143000 (que crea `condiciones_aceptadas_at`), PostgREST
  // rechaza el INSERT entero por columna desconocida y se caerían TODAS las
  // reservas web. Se reintenta sin esa columna y se deja rastro en los logs;
  // `consentimiento_newsletter` ya existe en producción y se conserva.
  if (insertError && esColumnaInexistente(insertError, "condiciones_aceptadas_at")) {
    console.error("[CREAR] Falta la columna reservas.condiciones_aceptadas_at (¿migración 20261003143000 sin aplicar?). Se guarda la reserva sin ella.");
    const { condiciones_aceptadas_at: _sinColumna, ...filaSinCondiciones } = filaReserva;
    ({ data: inserted, error: insertError } = await supabase
      .from("reservas")
      .insert(filaSinCondiciones)
      .select("id")
      .single());
  }

  if (insertError) {
    // Red de seguridad: si `trg_validar_capacidad` salta por una carrera
    // entre el chequeo de arriba y este INSERT, se traduce a una
    // respuesta de negocio normal en vez de un 500 genérico.
    const esAforo = insertError.code === "23514" || /aforo/i.test(insertError.message || "");
    if (esAforo) {
      return await avisar("sin_disponibilidad", "Rechazada por el trigger de aforo (carrera con otra reserva simultánea).", "No queda disponibilidad para esa fecha y hora.", 409);
    }
    console.error("[CREAR] Error insertando reserva:", insertError.message);
    return json({ ok: false, error: "internal_error" }, 500);
  }

  // AQUI NO SE MANDA NINGUN CORREO (decision del dueño, 2026-09-28).
  //
  // Historia, para no volver a darle vueltas:
  //   1. Esta rama llamaba a `sendEmail` (Resend directo) con
  //      `tplSolicitudRecibida` y no dejaba NI UNA FILA en
  //      `envios_email_reserva`: si fallaba, no se enteraba nadie mas que un
  //      aviso de campana, sin reintento ni seguimiento de entrega.
  //   2. Luego se delego en `emails-reserva/notificar` (que reclama fila,
  //      manda con `Idempotency-Key`, respeta la lista de supresion y deja
  //      que el cron de reintentos y `resend-webhook` hagan su trabajo), en
  //      segundo plano para no retrasar el 201.
  //   3. AHORA: no se manda. El cliente recibia DOS correos seguidos —este
  //      ("hemos recibido tu solicitud") y, en cuanto alguien revisaba la
  //      reserva, la 'propuesta' con los botones de aceptar/rechazar—. El
  //      primero sobra: la propia web ya le dice EN PANTALLA que se le
  //      contactara cuando se confirme la reserva. Su unico correo es la
  //      'propuesta'.
  //
  // COMO SE HA APAGADO: aqui se deja de llamar a `emails-reserva/notificar`,
  // y ADEMAS `emails-reserva` se niega a mandar 'solicitud_recibida' a una
  // reserva de canal 'web' venga la peticion de donde venga (ver
  // `debeEnviarSolicitudRecibida` en emails-reserva/plantillas.ts). Hacen
  // falta las dos cosas: `/notificar` lo llama tambien
  // `notify-reservation-change` desde el panel, asi que sin la regla del
  // canal bastaria con devolver una reserva web a 'pendiente' desde la lista
  // para que al cliente le llegara el correo que acabamos de quitar.
  //
  // `notificarViaEmailsReserva` (mas arriba en este fichero) se queda SIN
  // LLAMADORES pero NO se borra: es el contrato de delegacion documentado y el punto
  // exacto donde volver a engancharse si algun dia se quiere recuperar este
  // correo. Recuperarlo = volver a llamarla aqui Y vaciar
  // `CANALES_SIN_SOLICITUD_RECIBIDA` en emails-reserva/plantillas.ts.
  //
  // Los correos de RECHAZO (`avisar(...)`, mas arriba) no cambian: esos se
  // siguen mandando desde aqui porque en ese punto todavia no hay fila en
  // `reservas` sobre la que `emails-reserva` pudiera trabajar.

  return json({ ok: true, reserva_id: inserted.id, estado: "pendiente" }, 201);
}

// ============================================================
// ACCIÓN: confirmar
// ============================================================
async function handleConfirmar(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") || "";
  const payload = await verifyReservaToken(token, "confirmar");
  if (!payload) return html(pageTokenInvalido());

  const reserva = await fetchReserva(payload.id);
  if (!reserva) return html(pageTokenInvalido());
  if (reserva.estado !== "verificada" || fingerprint(reserva.estado, reserva.updated_at) !== payload.fp) {
    return html(pageTokenInvalido());
  }

  const { error } = await supabase.from("reservas").update({ estado: "confirmada" }).eq("id", reserva.id).eq("estado", "verificada");
  if (error) {
    console.error("[CONFIRMAR] Error actualizando:", error.message);
    return html(pageTokenInvalido());
  }
  // El cliente ha pulsado el enlace de SU correo: email verificado (doble
  // opt-in del newsletter, ver _shared/verificacion-email.ts). Nunca lanza.
  await registrarEmailVerificado(supabase as unknown as ClienteVerificacion, reserva.id, new Date().toISOString(), "CONFIRMAR");
  return html(pageReservaConfirmada(reserva.nombre || "", reserva.fecha, reserva.hora, reserva.numero_comensales));
}

// ============================================================
// ACCIÓN: cancelar (paso 1 — pantalla "¿seguro?", NO muta nada)
// ============================================================
// Se mantienen los dos pasos del diseño original a propósito: muchos
// clientes de correo PRE-CARGAN (prefetch) los enlaces de un email para
// escanearlos. Si cancelar fuera de un solo paso, ese escaneo cancelaría
// la reserva solo. Aquí el paso 1 es de solo lectura.
async function handleCancelarPreview(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") || "";
  const payload = await verifyReservaToken(token, "cancelar");
  if (!payload) return html(pageTokenInvalido());
  const reserva = await fetchReserva(payload.id);
  if (!reserva || fingerprint(reserva.estado, reserva.updated_at) !== payload.fp) return html(pageTokenInvalido());

  const ejecutarUrl = `${PUBLIC_BASE_URL}/cancelar/ejecutar?token=${encodeURIComponent(token)}`;
  return html(pageCancelarPreview(reserva.nombre || "", reserva.fecha, reserva.hora, reserva.numero_comensales, ejecutarUrl));
}

// ============================================================
// ACCIÓN: cancelar (paso 2 — ejecuta la cancelación)
// ============================================================
async function handleCancelarEjecutar(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") || "";
  const payload = await verifyReservaToken(token, "cancelar");
  if (!payload) return html(pageTokenInvalido());
  const reserva = await fetchReserva(payload.id);
  if (!reserva || fingerprint(reserva.estado, reserva.updated_at) !== payload.fp) return html(pageTokenInvalido());
  if (reserva.estado === "cancelada") return html(pageCancelada());

  const { error } = await supabase.from("reservas").update({ estado: "cancelada" }).eq("id", reserva.id);
  if (error) {
    console.error("[CANCELAR] Error actualizando:", error.message);
    return html(pageTokenInvalido());
  }
  return html(pageCancelada());
}

// ============================================================
// ROUTER
// ============================================================
serve(conAuditoriaDePeticion("reservas-web", createClientBase, async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const pathname = new URL(req.url).pathname;

  try {
    // Tabla de rutas en ./rutas.ts. Cualquier otra (incluida la retirada
    // POST /notificar-estado) -> 404.
    switch (resolverRuta(req.method, pathname)) {
      case "disponibilidad": return await handleDisponibilidad(req);
      case "crear": return await handleCrear(req);
      case "cierres": return await handleCierres(req);
      case "confirmar": return await handleConfirmar(req);
      case "cancelar": return await handleCancelarPreview(req);
      case "cancelar/ejecutar": return await handleCancelarEjecutar(req);
      case "salud": return handleSalud();
      default: return json({ ok: false, error: "not_found", route: rutaDelPath(pathname) }, 404);
    }
  } catch (err) {
    console.error("[RESERVAS-WEB] Error no controlado:", (err as Error)?.message, (err as Error)?.stack);
    return json({ ok: false, error: "internal_error" }, 500);
  }
}));
