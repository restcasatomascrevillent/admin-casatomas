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
//   Las rutas POST que no son /webhook exigen `x-webhook-secret` ==
//   WHATSAPP_RESERVAS_SECRET (compararTiempoConstante, FALLA CERRADO).
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
  type ReservaParaWhatsApp,
  type TipoAvisoWhatsApp,
  type PulsacionBoton,
  type EstadoEntrega,
  type MensajeLibre,
  type RespuestaEjecutar,
  type ValoresBotones,
} from "./logica.ts";

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

async function enviarAvisoReserva(reservaId: string): Promise<{ enviado: boolean; motivo?: string; tipo?: TipoAvisoWhatsApp; id?: string }> {
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
  const mensaje = mensajePlantilla({
    para,
    def,
    variables: variablesParaTipo(tipo, reserva),
    botones: await valoresBotones(def, reserva),
    datosOpacos: datosOpacos(reserva.id, tipo),
  });
  const { id, error } = await enviarMensaje(mensaje);
  if (error) {
    console.error(`[${FUENTE}] Meta rechazó el aviso '${tipo}' de la reserva ${reserva.id}: ${error}`);
    return { enviado: false, motivo: `meta: ${error}`, tipo };
  }
  console.log(`[${FUENTE}] Aviso '${tipo}' de la reserva ${reserva.id} enviado (${id})`);
  return { enviado: true, tipo, id: id ?? undefined };
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
  const { error } = await enviarMensaje(mensajeTexto(p.de, textoRespuestaBoton(respuesta, boton?.accion ?? null), p.mensajeId));
  if (error) console.error(`[${FUENTE}] No se pudo contestar en el chat tras el botón: ${error}`);
}

async function procesarMensajeLibre(m: MensajeLibre): Promise<void> {
  // Nadie lee este número: se le dice que llame. Una respuesta por mensaje.
  await marcarLeido(m.mensajeId);
  const { error } = await enviarMensaje(mensajeTexto(m.de, textoMensajeLibre()));
  if (error) console.warn(`[${FUENTE}] No se pudo contestar a un mensaje escrito: ${error}`);
}

async function procesarEstado(e: EstadoEntrega): Promise<void> {
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

async function estadoPlantillas(): Promise<Response> {
  const r = await llamarGraph(`${WABA_ID}/message_templates?fields=name,status,category,language,rejected_reason&limit=100`, { metodo: "GET" });
  if (!r.ok) return json({ ok: false, error: r.error }, 502);
  const nuestras = new Set(Object.values(PLANTILLAS).map((p) => p.nombre));
  const lista = ((r.datos?.data as Record<string, unknown>[] | undefined) ?? []).filter((p) => nuestras.has(String(p.name)));
  return json({ ok: true, web: WEB, plantillas: lista });
}

async function crearPlantillas(): Promise<Response> {
  const resultados: Record<string, unknown>[] = [];
  for (const def of Object.values(PLANTILLAS)) {
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
  return json({ ok: !error, tipo, id, error }, error ? 502 : 200);
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
    if (!secretoInternoValido(req)) return json({ ok: false, error: "no_autorizado" }, 401);

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
