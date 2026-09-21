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
// verify_jwt = false (ver config.toml) PARA TODA LA FUNCIÓN — no puede ser
// true a nivel de función porque las rutas GET las pulsa el cliente desde su
// correo, sin ninguna cabecera. La autenticación real de esas rutas es el
// token HMAC de un solo uso (tokens.ts). Las rutas POST /notificar,
// /recordatorios y /detectar-ausencias exigen la cabecera `x-webhook-secret`
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
// ENVÍO IDEMPOTENTE (ver PIEZA 3a de la migración para el razonamiento)
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
): Promise<{ id: string } | null> {
  await liberarPendientesAbandonados({ reserva_id: reservaId, tipo_email: tipoEmail });

  const { data, error } = await supabase
    .from("envios_email_reserva")
    .insert({ reserva_id: reservaId, tipo_email: tipoEmail, destinatario, plantilla_id: plantillaId, resultado: "pendiente" })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation sobre uq_envio_email_reserva_activo -> ya
    // reclamado por otra ejecución o ya enviado con éxito. No es un fallo.
    if (error.code !== "23505") {
      console.error(`[emails-reserva] Error reclamando envio (${reservaId}/${tipoEmail}):`, error.message);
    }
    return null;
  }
  return { id: data.id as string };
}

async function marcarResultadoEnvio(id: string, exito: boolean, detalle: { resendId?: string | null; error?: string }): Promise<void> {
  const cambios = exito
    ? { resultado: "enviado", resend_id: detalle.resendId ?? null, enviado_at: ahoraIso() }
    : { resultado: "fallido", error: detalle.error ?? "error_desconocido" };
  const { error } = await supabase.from("envios_email_reserva").update(cambios).eq("id", id);
  if (error) console.error(`[emails-reserva] Error actualizando registro de envio ${id}:`, error.message);
}

interface ResultadoEnvio {
  enviado: boolean;
  motivo?: string;
}

async function enviarCorreoParaReserva(reservaId: string): Promise<ResultadoEnvio> {
  const reserva = await fetchReserva(reservaId);
  if (!reserva) return { enviado: false, motivo: "reserva_no_encontrada" };
  if (!reserva.email) return { enviado: false, motivo: "reserva_sin_email" };

  const tipo = tipoEmailParaEstado(reserva.estado);
  if (!tipo) return { enviado: false, motivo: `sin_plantilla_para_estado_${reserva.estado}` };

  const plantilla = await obtenerPlantillaActual(tipo);
  if (!plantilla) return { enviado: false, motivo: `plantilla_no_configurada_${tipo}` };

  let urlsBotones: { principal?: string; secundario?: string } | undefined;
  if (tipo === "propuesta") {
    const huella = calcularHuella(reserva.estado, reserva.hora, reserva.espacio_id);
    const tokenAceptar = await firmarToken(TOKEN_SECRET, reserva.id, "aceptar", huella);
    const tokenRechazar = await firmarToken(TOKEN_SECRET, reserva.id, "rechazar", huella);
    urlsBotones = {
      principal: `${PUBLIC_BASE_URL}/aceptar?token=${encodeURIComponent(tokenAceptar)}`,
      secundario: `${PUBLIC_BASE_URL}/rechazar?token=${encodeURIComponent(tokenRechazar)}`,
    };
  }

  const datos = await construirDatosReserva(reserva, urlsBotones);
  const { asunto, html: cuerpoHtml } = renderPlantilla(plantilla, datos);

  const claim = await reclamarEnvio(reserva.id, tipo, reserva.email, plantilla.id);
  if (!claim) return { enviado: false, motivo: "ya_enviado_o_en_curso" };

  if (!RESEND_API_KEY) {
    await marcarResultadoEnvio(claim.id, false, { error: "resend_no_configurado" });
    return { enviado: false, motivo: "resend_no_configurado" };
  }

  try {
    const { data, error } = await resend.emails.send({ from: RESEND_FROM_EMAIL, to: [reserva.email], subject: asunto, html: cuerpoHtml });
    if (error) {
      await marcarResultadoEnvio(claim.id, false, { error: String(error) });
      return { enviado: false, motivo: "resend_error" };
    }
    await marcarResultadoEnvio(claim.id, true, { resendId: (data as { id?: string } | null)?.id });
    return { enviado: true };
  } catch (err) {
    await marcarResultadoEnvio(claim.id, false, { error: (err as Error)?.message ?? "excepcion" });
    return { enviado: false, motivo: "excepcion" };
  }
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
    const resultados = await Promise.allSettled(lotes[i].map((r) => enviarCorreoParaReserva(r.id)));
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
    if (req.method === "POST" && route === "enviar-prueba") return await handleEnviarPrueba(req);
    if (req.method === "GET" && route === "aceptar") return await handleAceptar(req);
    if (req.method === "GET" && route === "rechazar") return await handleRechazarPreview(req);
    if (req.method === "GET" && route === "rechazar/ejecutar") return await handleRechazarEjecutar(req);
    return json({ ok: false, error: "not_found", route }, 404);
  } catch (err) {
    console.error("[emails-reserva] Error no controlado:", (err as Error)?.message, (err as Error)?.stack);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
