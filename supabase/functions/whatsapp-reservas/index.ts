// ============================================================================
// WHATSAPP-RESERVAS — Edge Function (prueba de concepto, 21/11/2026)
// ============================================================================
// Avisos de reserva por WhatsApp (API de WhatsApp Cloud de Meta) para los
// clientes que eligen ese canal al reservar. Guía y pasos en
// docs/funcionalidades/whatsapp-reservas.md; la lógica pura, en logica.ts.
//
// Rutas (bajo /functions/v1/whatsapp-reservas/...):
//   GET  /webhook               -> verificación del webhook de Meta
//                                  (hub.verify_token == WHATSAPP_VERIFY_TOKEN)
//   POST /webhook               -> avisos de Meta: pulsaciones de botones y
//                                  estados de entrega. Firma X-Hub-Signature-256
//                                  con WHATSAPP_APP_SECRET, FALLA CERRADO.
//   POST /enviar   {reserva_id} -> manda el aviso que toque por el ESTADO de la
//                                  reserva. La llama emails-reserva (ver
//                                  avisarPorWhatsAppSiLoEligio) cuando el
//                                  cliente eligió WhatsApp. Responde
//                                  { enviado, motivo? }; enviado=false -> correo.
//   POST /plantillas            -> estado de las plantillas en Meta
//   POST /plantillas/crear      -> registra en Meta las que falten
//   POST /suscribir             -> suscribe la app a la cuenta de WhatsApp
//                                  (para recibir el webhook)
//   POST /prueba {telefono, tipo?} -> manda una plantilla con datos de ejemplo
//                                  (tipo 'resena' para la petición de reseña)
//   POST /resenas               -> pide reseña a las reservas que toque (hora
//                                  de la reserva + 3 h; resenas.ts). La llama
//                                  pg_cron cada 10 min (whatsapp_resenas_disparar,
//                                  migración 20261222100000) solo si hay alguna.
//
// Cada mensaje que sale se apunta en `whatsapp_mensajes` (tipo, categoría,
// estado) y el webhook le añade si Meta lo cobra: de ahí sale el coste de
// WhatsApp en Super Admin › Servicios (servicios-uso).
//
// Si Meta no deja usar la plantilla (aún sin aprobar, pausada…), /enviar lo
// reintenta SIN plantilla (logica.ts, mensajeSinPlantilla): Meta lo admite
// dentro de las 24 h siguientes a que el cliente escriba, con los mismos
// botones de respuesta. Fuera de esa ventana falla igual y va el correo.
//   Las rutas POST que no son /webhook exigen `x-webhook-secret` ==
//   WHATSAPP_RESERVAS_SECRET (compararTiempoConstante, FALLA CERRADO).
//   /resenas, /plantillas y /plantillas/crear aceptan además
//   WHATSAPP_RESENAS_CRON_SECRET (el del cron, también en Vault).
//
// Al pulsar «Sí, confirmo» / «No puedo, cancelar», el botón trae un payload
// corto firmado (logica.ts). Aquí se comprueba, se firma el token normal de
// emails-reserva y se llama a su POST /enlace/ejecutar con via='whatsapp': la
// MISMA lógica que el botón del correo (estado, aforo, carreras, avisos al
// panel). Después se contesta en el chat con el resultado.
//
// verify_jwt = false (config.toml): Meta no manda JWT de Supabase.
//
// Secrets (Deno.env):
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_WABA_ID,
//   WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN   (los pone el dueño desde Meta)
//   WHATSAPP_RESERVAS_SECRET                     (rutas internas)
//   EMAILS_RESERVA_TOKEN_SECRET                  (el mismo que emails-reserva)
// Opcionales:
//   WHATSAPP_GRAPH_VERSION  (por defecto v23.0)
//   WEB_CASA_TOMAS_URL      (enlaces de los botones; por defecto la web pública)
//   WHATSAPP_RESENAS_ACTIVO=true          (enciende la petición de reseña)
//   WHATSAPP_RESENAS_CRON_SECRET          (el cron; mismo valor en Vault
//                                          'whatsapp_resenas_cron_secret')
//   WHATSAPP_RESENAS_DESTINATARIOS=todos  (por defecto solo quien eligió WhatsApp)
//   WHATSAPP_RESPUESTA_AUTOMATICA=false   (no contestar «nadie lee este número»:
//                                          para cuando el número se use también
//                                          en la app WhatsApp Business)
// ============================================================================

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { enSegundoPlano } from "../_shared/logs-web/servidor.ts";
import { firmarToken, firmarTokenGestion, calcularHuella } from "../emails-reserva/tokens.ts";
import {
  plantillas,
  cuerpoCrearPlantilla,
  tipoAvisoParaEstado,
  esTipoAvisoWhatsApp,
  variablesParaTipo,
  mensajePlantilla,
  mensajeSinPlantilla,
  mensajeTexto,
  telefonoParaWhatsApp,
  consultaMapa,
  firmarPayloadBoton,
  leerPayloadBoton,
  firmaMetaValida,
  compararTiempoConstante,
  leerWebhook,
  datosOpacos,
  leerDatosOpacos,
  textoRespuestaBoton,
  textoMensajeLibre,
  negocioDeMarca,
  type DefinicionPlantilla,
  type TipoPlantillaWhatsApp,
  type ReservaParaWhatsApp,
  type TipoAvisoWhatsApp,
  type PulsacionBoton,
  type EstadoEntrega,
  type MensajeLibre,
  type RespuestaEjecutar,
  type ValoresBotones,
} from "./logica.ts";
import {
  PLACE_ID_CASA_TOMAS,
  placeIdValido,
  plantillaResena,
  variablesResena,
  decidirResena,
  destinatariosResena,
  diasAMirar,
  ESTADOS_RESENA,
  type ReservaParaResena,
} from "./resenas.ts";
import { hoyEnMadridIso } from "../emails-reserva/tiempo.ts";
import type { CategoriaWhatsApp } from "../_shared/whatsapp-tarifas.ts";

const FUENTE = "whatsapp-reservas";
const createClient = clienteConAuditoria(createClientBase, FUENTE);

const env = (nombre: string): string => Deno.env.get(nombre) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ACCESS_TOKEN = env("WHATSAPP_ACCESS_TOKEN");
const PHONE_NUMBER_ID = env("WHATSAPP_PHONE_NUMBER_ID");
const WABA_ID = env("WHATSAPP_WABA_ID");
const APP_SECRET = env("WHATSAPP_APP_SECRET");
const VERIFY_TOKEN = env("WHATSAPP_VERIFY_TOKEN");
const SECRETO_INTERNO = env("WHATSAPP_RESERVAS_SECRET");
const SECRETO_CRON = env("WHATSAPP_RESENAS_CRON_SECRET");
const RESENAS_ACTIVO = env("WHATSAPP_RESENAS_ACTIVO").trim().toLowerCase() === "true";
const DESTINATARIOS_RESENA = destinatariosResena(env("WHATSAPP_RESENAS_DESTINATARIOS"));
const RESPUESTA_AUTOMATICA = env("WHATSAPP_RESPUESTA_AUTOMATICA").trim().toLowerCase() !== "false";
const MAX_RESENAS_POR_PASADA = 30;
const TOKEN_SECRET = env("EMAILS_RESERVA_TOKEN_SECRET");
const GRAPH = `https://graph.facebook.com/${env("WHATSAPP_GRAPH_VERSION") || "v23.0"}`;
const WEB = (env("WEB_CASA_TOMAS_URL") || "https://restaurantecasatomascrevillente.es").replace(/\/+$/, "");
const PLANTILLAS = plantillas(WEB);
const ENLACE_EJECUTAR_URL = `${SUPABASE_URL}/functions/v1/emails-reserva/enlace/ejecutar`;
const TIMEOUT_MS = 10000;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

/** Rutas internas: `x-webhook-secret` == WHATSAPP_RESERVAS_SECRET. Falla cerrado si no está configurado. */
function secretoInternoValido(req: Request): boolean {
  if (!SECRETO_INTERNO) return false;
  return compararTiempoConstante(req.headers.get("x-webhook-secret") ?? "", SECRETO_INTERNO);
}

/** El secreto del cron solo abre las rutas que usa el cron (nunca /prueba ni /enviar). */
const RUTAS_CRON = new Set(["resenas", "plantillas", "plantillas/crear"]);
function secretoCronValido(req: Request): boolean {
  if (!SECRETO_CRON) return false;
  return compararTiempoConstante(req.headers.get("x-webhook-secret") ?? "", SECRETO_CRON);
}

function configurado(): boolean {
  return Boolean(ACCESS_TOKEN && PHONE_NUMBER_ID && WABA_ID && TOKEN_SECRET);
}

// ----------------------------------------------------------------------------
// Graph API de Meta
// ----------------------------------------------------------------------------

interface RespuestaGraph {
  ok: boolean;
  status: number | null;
  datos: Record<string, unknown> | null;
  error: string | null;
}

async function llamarGraph(ruta: string, opciones: { metodo?: "GET" | "POST"; cuerpo?: unknown } = {}): Promise<RespuestaGraph> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GRAPH}/${ruta}`, {
      method: opciones.metodo ?? "POST",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      signal: controlador.signal,
    });
    const datos = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const errorMeta = (datos?.error ?? null) as { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } | null;
    const error = res.ok
      ? null
      : `${errorMeta?.code ?? res.status}${errorMeta?.error_subcode ? `/${errorMeta.error_subcode}` : ""}: ${errorMeta?.error_user_msg || errorMeta?.message || "sin_detalle"}`;
    return { ok: res.ok, status: res.status, datos, error };
  } catch (err) {
    return { ok: false, status: null, datos: null, error: (err as Error)?.name === "AbortError" ? "timeout" : (err as Error)?.message ?? "error_red" };
  } finally {
    clearTimeout(temporizador);
  }
}

async function enviarMensaje(mensaje: Record<string, unknown>): Promise<{ id: string | null; error: string | null }> {
  const r = await llamarGraph(`${PHONE_NUMBER_ID}/messages`, { cuerpo: mensaje });
  const id = ((r.datos?.messages as { id?: string }[] | undefined)?.[0]?.id) ?? null;
  return { id, error: r.ok ? null : r.error };
}

// ----------------------------------------------------------------------------
// Registro de lo enviado (coste en Servicios)
// ----------------------------------------------------------------------------

/** Apunta un mensaje en `whatsapp_mensajes`. Si falla, solo se avisa en el log: el mensaje ya salió. */
async function registrarMensaje(m: {
  reservaId?: string | null;
  tipo: TipoPlantillaWhatsApp | "respuesta" | "prueba";
  plantilla?: string | null;
  categoria: CategoriaWhatsApp;
  wamid?: string | null;
  error?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("whatsapp_mensajes").insert({
    reserva_id: m.reservaId ?? null,
    tipo: m.tipo,
    plantilla: m.plantilla ?? null,
    categoria: m.categoria,
    wamid: m.wamid ?? null,
    estado: m.error ? "error" : "enviado",
    error: m.error ? m.error.slice(0, 500) : null,
  });
  if (error) console.warn(`[${FUENTE}] No se pudo apuntar el mensaje (${m.tipo}) en whatsapp_mensajes: ${error.message}`);
}

const ORDEN_ESTADO: Record<string, number> = { enviando: 0, enviado: 1, entregado: 2, leido: 3 };
const ESTADO_META: Record<string, string> = { sent: "enviado", delivered: "entregado", read: "leido", failed: "fallido" };

/** Estado de entrega y precio que manda Meta → la fila del mensaje (sin bajar de 'leido' a 'entregado'). */
async function actualizarMensaje(e: EstadoEntrega): Promise<void> {
  if (!e.mensajeId) return;
  const nuevo = ESTADO_META[e.estado];
  const cambios: Record<string, unknown> = { actualizado_en: new Date().toISOString() };
  if (e.precio) {
    cambios.facturable = e.precio.facturable;
    cambios.categoria_cobrada = e.precio.categoria;
    cambios.tipo_precio = e.precio.tipo;
  }
  if (nuevo === "fallido") {
    cambios.estado = "fallido";
    cambios.error = e.errores.map((x) => `${x.codigo ?? "?"} ${x.titulo}`).join("; ").slice(0, 500) || "sin_detalle";
    const { error } = await supabase.from("whatsapp_mensajes").update(cambios).eq("wamid", e.mensajeId);
    if (error) console.warn(`[${FUENTE}] whatsapp_mensajes (fallido): ${error.message}`);
    await supabase.from("whatsapp_resenas").update({ estado: "error", motivo: String(cambios.error), actualizado_en: cambios.actualizado_en }).eq("wamid", e.mensajeId);
    return;
  }
  if (nuevo && nuevo in ORDEN_ESTADO) {
    const anteriores = Object.keys(ORDEN_ESTADO).filter((k) => ORDEN_ESTADO[k] < ORDEN_ESTADO[nuevo]);
    const { error } = await supabase.from("whatsapp_mensajes").update({ ...cambios, estado: nuevo }).eq("wamid", e.mensajeId).in("estado", anteriores);
    if (error) console.warn(`[${FUENTE}] whatsapp_mensajes (${nuevo}): ${error.message}`);
  }
  if (e.precio) {
    // Por si el estado no cambió (llegó tarde) pero sí trae el precio.
    const { error } = await supabase.from("whatsapp_mensajes").update(cambios).eq("wamid", e.mensajeId);
    if (error) console.warn(`[${FUENTE}] whatsapp_mensajes (precio): ${error.message}`);
  }
}

// ----------------------------------------------------------------------------
// POST /enviar — aviso de una reserva
// ----------------------------------------------------------------------------

async function leerReserva(id: string): Promise<ReservaParaWhatsApp | null> {
  const { data, error } = await supabase
    .from("reservas")
    .select("id, estado, nombre, telefono, fecha, hora, numero_comensales, marca")
    .eq("id", id)
    .maybeSingle();
  if (error) console.error(`[${FUENTE}] No se pudo leer la reserva ${id}:`, error.message);
  return (data as ReservaParaWhatsApp | null) ?? null;
}

async function valoresBotones(def: DefinicionPlantilla, r: ReservaParaWhatsApp): Promise<ValoresBotones> {
  const valores: ValoresBotones = {};
  for (const b of def.botones) {
    if (b.tipo === "respuesta") {
      valores.payloads = { ...valores.payloads, [b.accion]: await firmarPayloadBoton(TOKEN_SECRET, r.id, b.accion, r.hora) };
    } else if (b.sufijo === "gestionar") {
      valores.tokenGestion = await firmarTokenGestion(TOKEN_SECRET, r.id, r.fecha);
    } else if (b.sufijo === "mapa") {
      valores.mapa = consultaMapa(r.marca);
    }
  }
  return valores;
}

async function enviarAvisoReserva(
  reservaId: string,
): Promise<{ enviado: boolean; motivo?: string; tipo?: TipoAvisoWhatsApp; id?: string; sinPlantilla?: boolean }> {
  if (!configurado()) return { enviado: false, motivo: "whatsapp_no_configurado" };
  const reserva = await leerReserva(reservaId);
  if (!reserva) return { enviado: false, motivo: "reserva_no_encontrada" };
  // Las plantillas (y sus enlaces) son de Casa Tomás. Touza tendrá las suyas
  // con su número; mientras, su aviso va por correo.
  if (negocioDeMarca(reserva.marca).marca !== "casa_tomas") return { enviado: false, motivo: "marca_sin_plantillas_whatsapp" };
  const tipo = tipoAvisoParaEstado(reserva.estado);
  if (!tipo) return { enviado: false, motivo: `sin_aviso_para_estado_${reserva.estado}` };
  const para = telefonoParaWhatsApp(reserva.telefono);
  if (!para) return { enviado: false, motivo: "telefono_no_valido", tipo };

  const def = PLANTILLAS[tipo];
  const contenido = {
    para,
    def,
    variables: variablesParaTipo(tipo, reserva),
    botones: await valoresBotones(def, reserva),
    datosOpacos: datosOpacos(reserva.id, tipo),
  };
  const { id, error } = await enviarMensaje(mensajePlantilla(contenido));
  if (!error) {
    console.log(`[${FUENTE}] Aviso '${tipo}' de la reserva ${reserva.id} enviado (${id})`);
    await registrarMensaje({ reservaId: reserva.id, tipo, plantilla: def.nombre, categoria: "utility", wamid: id });
    return { enviado: true, tipo, id: id ?? undefined };
  }
  console.error(`[${FUENTE}] Meta rechazó la plantilla del aviso '${tipo}' de la reserva ${reserva.id}: ${error}. Se intenta sin plantilla.`);
  // Sin plantilla: solo sale si el cliente ha escrito en las últimas 24 h.
  const sinPlantilla = await enviarMensaje(mensajeSinPlantilla(contenido));
  if (sinPlantilla.error) {
    console.error(`[${FUENTE}] Tampoco sin plantilla (¿fuera de la ventana de 24 h?): ${sinPlantilla.error}`);
    await registrarMensaje({ reservaId: reserva.id, tipo, plantilla: def.nombre, categoria: "utility", error: `${error} | ${sinPlantilla.error}` });
    return { enviado: false, motivo: `meta: ${error} | sin plantilla: ${sinPlantilla.error}`, tipo };
  }
  // Sin plantilla = mensaje de servicio (texto libre dentro de las 24 h).
  await registrarMensaje({ reservaId: reserva.id, tipo, categoria: "service", wamid: sinPlantilla.id });
  console.log(`[${FUENTE}] Aviso '${tipo}' de la reserva ${reserva.id} enviado SIN plantilla (${sinPlantilla.id})`);
  return { enviado: true, tipo, id: sinPlantilla.id ?? undefined, sinPlantilla: true };
}

// ----------------------------------------------------------------------------
// Webhook
// ----------------------------------------------------------------------------

function verificarWebhook(url: URL): Response {
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const reto = url.searchParams.get("hub.challenge") ?? "";
  if (modo === "subscribe" && VERIFY_TOKEN && compararTiempoConstante(token, VERIFY_TOKEN) && /^[\w-]{1,200}$/.test(reto)) {
    return new Response(reto, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}

async function marcarLeido(mensajeId: string): Promise<void> {
  const r = await llamarGraph(`${PHONE_NUMBER_ID}/messages`, { cuerpo: { messaging_product: "whatsapp", status: "read", message_id: mensajeId } });
  if (!r.ok) console.warn(`[${FUENTE}] No se pudo marcar como leído ${mensajeId}: ${r.error}`);
}

async function ejecutarEnEmailsReserva(token: string): Promise<RespuestaEjecutar | null> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENLACE_EJECUTAR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, via: "whatsapp" }),
      signal: controlador.signal,
    });
    return (await res.json().catch(() => null)) as RespuestaEjecutar | null;
  } catch (err) {
    console.error(`[${FUENTE}] emails-reserva /enlace/ejecutar no respondió:`, (err as Error)?.message);
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}

async function procesarPulsacion(p: PulsacionBoton): Promise<void> {
  await marcarLeido(p.mensajeId);
  const boton = await leerPayloadBoton(TOKEN_SECRET, p.payload);
  let respuesta: RespuestaEjecutar | null = { estado: "invalido" };
  if (boton) {
    // Mismo token que el botón del correo, con la huella de cuando se mandó
    // el WhatsApp: si la hora ha cambiado, emails-reserva lo da por inválido.
    const token = await firmarToken(TOKEN_SECRET, boton.reservaId, boton.accion, calcularHuella("verificada", boton.hora));
    respuesta = await ejecutarEnEmailsReserva(token);
    console.log(`[${FUENTE}] Botón '${boton.accion}' de la reserva ${boton.reservaId}: ${respuesta?.estado ?? "sin_respuesta"}`);
  } else {
    console.warn(`[${FUENTE}] Botón con payload no válido o caducado (de ${p.de.slice(0, 5)}…)`);
  }
  const { id, error } = await enviarMensaje(mensajeTexto(p.de, textoRespuestaBoton(respuesta, boton?.accion ?? null), p.mensajeId));
  if (error) console.error(`[${FUENTE}] No se pudo contestar en el chat tras el botón: ${error}`);
  else await registrarMensaje({ reservaId: boton?.reservaId ?? null, tipo: "respuesta", categoria: "service", wamid: id });
}

async function procesarMensajeLibre(m: MensajeLibre): Promise<void> {
  // Si el número se usa también en la app WhatsApp Business (coexistencia),
  // lo contesta el personal desde la app: ni se marca leído ni se responde.
  if (!RESPUESTA_AUTOMATICA) return;
  // Nadie lee este número: se le dice que llame. Una respuesta por mensaje.
  await marcarLeido(m.mensajeId);
  const { id, error } = await enviarMensaje(mensajeTexto(m.de, textoMensajeLibre()));
  if (error) console.warn(`[${FUENTE}] No se pudo contestar a un mensaje escrito: ${error}`);
  else await registrarMensaje({ tipo: "respuesta", categoria: "service", wamid: id });
}

async function procesarEstado(e: EstadoEntrega): Promise<void> {
  await actualizarMensaje(e).catch((err) => console.warn(`[${FUENTE}] No se pudo actualizar el mensaje ${e.mensajeId}:`, (err as Error)?.message));
  if (e.estado !== "failed") return;
  const error = e.errores.map((x) => `${x.codigo ?? "?"} ${x.titulo}${x.detalle ? ` (${x.detalle})` : ""}`).join("; ") || "sin_detalle";
  const opacos = leerDatosOpacos(e.datosOpacos);
  console.error(`[${FUENTE}] WhatsApp no entregado (${opacos ? `reserva ${opacos.reservaId}, ${opacos.tipo}` : "sin reserva"}): ${error}`);
  if (!opacos) return;
  // Meta lo aceptó pero no llegó (p. ej. ese número no tiene WhatsApp): que
  // el personal lo sepa y le llame. TODO(producción): mandar el correo.
  const reserva = await leerReserva(opacos.reservaId);
  const { error: errorAviso } = await supabase.from("notificaciones_dashboard").insert({
    tipo: "whatsapp_fallido",
    titulo: "No le ha llegado el WhatsApp de su reserva a un cliente",
    mensaje: `${reserva?.nombre || "Cliente"} (${reserva?.telefono || "sin teléfono"}), ${reserva?.fecha ?? "?"} ${(reserva?.hora ?? "").slice(0, 5)}: ${error}. Llámale.`,
    referencia_id: opacos.reservaId,
    referencia_tipo: "reserva",
    prioridad: "alta",
  });
  if (errorAviso) console.error(`[${FUENTE}] No se pudo crear el aviso del panel:`, errorAviso.message);
}

async function procesarWebhook(cuerpo: unknown): Promise<void> {
  const { pulsaciones, estados, libres } = leerWebhook(cuerpo);
  for (const p of pulsaciones) await procesarPulsacion(p).catch((err) => console.error(`[${FUENTE}] Error con una pulsación:`, err));
  for (const m of libres) await procesarMensajeLibre(m).catch((err) => console.error(`[${FUENTE}] Error con un mensaje escrito:`, err));
  for (const e of estados) await procesarEstado(e).catch((err) => console.error(`[${FUENTE}] Error con un estado:`, err));
}

async function recibirWebhook(req: Request): Promise<Response> {
  const crudo = new Uint8Array(await req.arrayBuffer());
  if (!(await firmaMetaValida(crudo, req.headers.get("x-hub-signature-256"), APP_SECRET))) {
    console.warn(`[${FUENTE}] Webhook con firma no válida: descartado`);
    return new Response("unauthorized", { status: 401 });
  }
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(new TextDecoder().decode(crudo));
  } catch {
    return new Response("bad_request", { status: 400 });
  }
  // Meta reintenta si no respondemos rápido: se contesta ya y se procesa detrás.
  await (enSegundoPlano(procesarWebhook(cuerpo)) ?? Promise.resolve());
  return new Response("ok", { status: 200 });
}

// ----------------------------------------------------------------------------
// Rutas internas (plantillas, suscripción, prueba)
// ----------------------------------------------------------------------------

/** place_id de la ficha de Google (config_google_places, la de sync-google-reviews); si no, el de Casa Tomás. */
async function placeIdResena(): Promise<string> {
  const { data, error } = await supabase.from("config_google_places").select("place_id").limit(1).maybeSingle();
  if (error) console.warn(`[${FUENTE}] config_google_places: ${error.message}`);
  const id = (data as { place_id?: unknown } | null)?.place_id;
  return placeIdValido(id) ? id : PLACE_ID_CASA_TOMAS;
}

async function todasLasPlantillas(): Promise<DefinicionPlantilla[]> {
  return [...Object.values(PLANTILLAS), plantillaResena(await placeIdResena())];
}

async function estadoPlantillas(): Promise<Response> {
  const r = await llamarGraph(`${WABA_ID}/message_templates?fields=name,status,category,language,rejected_reason&limit=100`, { metodo: "GET" });
  if (!r.ok) return json({ ok: false, error: r.error }, 502);
  const nuestras = new Set((await todasLasPlantillas()).map((p) => p.nombre));
  const lista = ((r.datos?.data as Record<string, unknown>[] | undefined) ?? []).filter((p) => nuestras.has(String(p.name)));
  return json({ ok: true, web: WEB, plantillas: lista });
}

async function crearPlantillas(): Promise<Response> {
  const resultados: Record<string, unknown>[] = [];
  for (const def of await todasLasPlantillas()) {
    const r = await llamarGraph(`${WABA_ID}/message_templates`, { cuerpo: cuerpoCrearPlantilla(def) });
    resultados.push({ nombre: def.nombre, ok: r.ok, estado: r.datos?.status ?? null, categoria: r.datos?.category ?? null, error: r.error });
  }
  return json({ ok: resultados.every((x) => x.ok), web: WEB, resultados });
}

async function suscribirApp(): Promise<Response> {
  const r = await llamarGraph(`${WABA_ID}/subscribed_apps`);
  return json({ ok: r.ok, error: r.error, datos: r.datos }, r.ok ? 200 : 502);
}

async function enviarPrueba(req: Request): Promise<Response> {
  const cuerpo = (await req.json().catch(() => ({}))) as { telefono?: string; tipo?: string };
  const para = telefonoParaWhatsApp(cuerpo.telefono);
  if (!para) return json({ ok: false, error: "telefono_no_valido" }, 400);
  if (cuerpo.tipo === "resena") {
    const placeId = await placeIdResena();
    const def = plantillaResena(placeId);
    const fecha = hoyEnMadridIso();
    const r = await enviarMensaje(
      mensajePlantilla({ para, def, variables: variablesResena({ nombre: "Prueba", fecha, marca: "casa_tomas" }), botones: { placeId } }),
    );
    await registrarMensaje({ tipo: "prueba", plantilla: def.nombre, categoria: "utility", wamid: r.id, error: r.error });
    return json({ ok: !r.error, tipo: "resena", id: r.id, error: r.error }, r.error ? 502 : 200);
  }
  const tipo: TipoAvisoWhatsApp = esTipoAvisoWhatsApp(cuerpo.tipo) ? cuerpo.tipo : "confirmada";
  // Reserva de mentira: los botones de respuesta llevarán un id que no existe
  // (al pulsarlos, «este botón ya no sirve»), así que no toca ninguna reserva.
  const ejemplo: ReservaParaWhatsApp = {
    id: "00000000-0000-0000-0000-000000000000", estado: "verificada", nombre: "Prueba", telefono: para,
    fecha: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), hora: "21:30", numero_comensales: 2, marca: "casa_tomas",
  };
  const def = PLANTILLAS[tipo];
  const { id, error } = await enviarMensaje(
    mensajePlantilla({ para, def, variables: variablesParaTipo(tipo, ejemplo), botones: await valoresBotones(def, ejemplo) }),
  );
  await registrarMensaje({ tipo: "prueba", plantilla: def.nombre, categoria: "utility", wamid: id, error });
  return json({ ok: !error, tipo, id, error }, error ? 502 : 200);
}

// ----------------------------------------------------------------------------
// POST /resenas — petición de reseña (hora de la reserva + 3 h)
// ----------------------------------------------------------------------------

async function apuntarResena(reservaId: string, estado: "omitida" | "enviando", motivo: string | null): Promise<boolean> {
  // La clave primaria (reserva_id) es la que impide mandar dos veces: si ya
  // hay fila (otra pasada a la vez), no se inserta y no se manda.
  const { data, error } = await supabase
    .from("whatsapp_resenas")
    .upsert({ reserva_id: reservaId, estado, motivo }, { onConflict: "reserva_id", ignoreDuplicates: true })
    .select("reserva_id");
  if (error) {
    console.error(`[${FUENTE}] whatsapp_resenas (${reservaId}): ${error.message}`);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function pedirResenas(): Promise<Response> {
  if (!configurado()) return json({ ok: false, error: "whatsapp_no_configurado" }, 503);
  if (!RESENAS_ACTIVO) return json({ ok: true, activo: false });
  const ahora = new Date();
  const { desde, hasta } = diasAMirar(hoyEnMadridIso());
  const { data, error } = await supabase
    .from("reservas")
    .select("id, estado, nombre, telefono, fecha, hora, numero_comensales, marca, canal_avisos")
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .in("estado", ESTADOS_RESENA as string[])
    .order("fecha")
    .order("hora")
    .limit(500);
  if (error) {
    console.error(`[${FUENTE}] No se pudieron leer las reservas para las reseñas: ${error.message}`);
    return json({ ok: false, error: "error_bd" }, 500);
  }
  const reservas = (data ?? []) as ReservaParaResena[];
  const ids = reservas.map((r) => r.id);
  const hechas = new Set<string>();
  if (ids.length) {
    const { data: filas, error: errorHechas } = await supabase.from("whatsapp_resenas").select("reserva_id").in("reserva_id", ids);
    if (errorHechas) {
      console.error(`[${FUENTE}] whatsapp_resenas: ${errorHechas.message}`);
      return json({ ok: false, error: "error_bd" }, 500);
    }
    for (const f of filas ?? []) hechas.add(String((f as { reserva_id: string }).reserva_id));
  }

  const placeId = await placeIdResena();
  const def = plantillaResena(placeId);
  const resumen = { enviadas: 0, omitidas: 0, esperando: 0, errores: 0, motivos: {} as Record<string, number> };
  for (const r of reservas) {
    if (hechas.has(r.id)) continue;
    const d = decidirResena(r, ahora, { destinatarios: DESTINATARIOS_RESENA });
    if (d.accion === "esperar") {
      resumen.esperando++;
      continue;
    }
    if (d.accion === "omitir") {
      if (await apuntarResena(r.id, "omitida", d.motivo)) {
        resumen.omitidas++;
        resumen.motivos[d.motivo] = (resumen.motivos[d.motivo] ?? 0) + 1;
      }
      continue;
    }
    if (resumen.enviadas + resumen.errores >= MAX_RESENAS_POR_PASADA) break; // el resto, en la siguiente pasada
    if (!(await apuntarResena(r.id, "enviando", null))) continue;
    const { id, error: errorEnvio } = await enviarMensaje(
      mensajePlantilla({ para: d.para, def, variables: variablesResena(r), botones: { placeId }, datosOpacos: datosOpacos(r.id, "resena") }),
    );
    await supabase
      .from("whatsapp_resenas")
      .update({ estado: errorEnvio ? "error" : "enviada", motivo: errorEnvio ? errorEnvio.slice(0, 500) : null, wamid: id, actualizado_en: new Date().toISOString() })
      .eq("reserva_id", r.id);
    await registrarMensaje({ reservaId: r.id, tipo: "resena", plantilla: def.nombre, categoria: "utility", wamid: id, error: errorEnvio });
    if (errorEnvio) {
      resumen.errores++;
      console.error(`[${FUENTE}] Meta no aceptó la petición de reseña de la reserva ${r.id}: ${errorEnvio}`);
    } else {
      resumen.enviadas++;
      console.log(`[${FUENTE}] Petición de reseña de la reserva ${r.id} enviada (${id})`);
    }
  }
  return json({ ok: true, activo: true, destinatarios: DESTINATARIOS_RESENA, ...resumen });
}

// ----------------------------------------------------------------------------
// Router
// ----------------------------------------------------------------------------

serve(conAuditoriaDePeticion(FUENTE, createClientBase, async (req: Request) => {
  const url = new URL(req.url);
  const segmentos = url.pathname.split("/").filter(Boolean);
  const idx = segmentos.indexOf(FUENTE);
  const ruta = (idx === -1 ? segmentos : segmentos.slice(idx + 1)).join("/");

  try {
    if (ruta === "webhook" && req.method === "GET") return verificarWebhook(url);
    if (ruta === "webhook" && req.method === "POST") return await recibirWebhook(req);

    if (req.method !== "POST") return json({ ok: false, error: "not_found" }, 404);
    if (!secretoInternoValido(req) && !(RUTAS_CRON.has(ruta) && secretoCronValido(req))) {
      return json({ ok: false, error: "no_autorizado" }, 401);
    }

    if (ruta === "resenas") return await pedirResenas();
    if (ruta === "enviar") {
      const cuerpo = (await req.json().catch(() => ({}))) as { reserva_id?: unknown };
      if (typeof cuerpo.reserva_id !== "string" || !cuerpo.reserva_id) return json({ enviado: false, motivo: "reserva_id_requerido" }, 400);
      return json(await enviarAvisoReserva(cuerpo.reserva_id));
    }
    if (!configurado()) return json({ ok: false, error: "whatsapp_no_configurado" }, 503);
    if (ruta === "plantillas") return await estadoPlantillas();
    if (ruta === "plantillas/crear") return await crearPlantillas();
    if (ruta === "suscribir") return await suscribirApp();
    if (ruta === "prueba") return await enviarPrueba(req);
    return json({ ok: false, error: "not_found", ruta }, 404);
  } catch (err) {
    console.error(`[${FUENTE}] Error no controlado:`, (err as Error)?.message);
    return json({ ok: false, error: "internal_error" }, 500);
  }
}));
