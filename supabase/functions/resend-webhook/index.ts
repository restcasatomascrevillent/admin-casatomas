import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verificarWebhookResend, type CabecerasSvix } from "./firma.ts";
import {
  mapearEventoAEstadoEntrega,
  debeAvisarPersonal,
  debeSuprimirDireccion,
  prioridadAvisoWebhook,
  debeCrearAvisoWebhook,
  construirMensajeAvisoWebhook,
  ORIGEN_RESEND_WEBHOOK,
  type EstadoEntrega,
} from "./eventos.ts";
import {
  decidirBajaNewsletter,
  decidirDesvinculoContacto,
  broadcastIdDe,
  idArchivoEvento,
  destinatarioArchivo,
  patronIlikeExacto,
  type DecisionBajaNewsletter,
} from "./newsletter.ts";

// ============================================================================
// RESEND-WEBHOOK — recibe los eventos asíncronos de Resend (delivered,
// bounced, complained, suppressed, opened, clicked...) y los archiva en
// `email_eventos` (genérica, para cualquier remitente del proyecto).
//
// ANTES DE ESTA ENTREGA este fichero solo archivaba: ninguna fila de
// `envios_email_reserva` se volvía a tocar tras el envío síncrono, así que
// un rebote/queja/supresión que llegaba ~0.4s después por aquí nunca se
// reflejaba en ningún sitio que alguien fuera a mirar. Verificado en vivo
// con bounced@resend.dev / complained@resend.dev / suppressed@resend.dev:
// los tres devolvían ok:true y la fila se quedaba en resultado='enviado'
// para siempre — la maquinaria de reintentos de emails-reserva (ver
// reintentos.ts) solo se dispara con errores SÍNCRONOS (formato,
// credenciales, 429, 5xx); nunca con este caso.
//
// QUÉ CAMBIA AQUÍ (ver eventos.ts y firma.ts para el razonamiento completo
// de cada pieza, y la migración de esta entrega para el porqué de cada
// columna/tabla nueva):
//   1. Enlaza el evento con su envío por `envios_email_reserva.resend_id`
//      = `event.data.email_id`, y actúa según el tipo:
//        - delivered  -> estado_entrega='entregado' en la fila (nada más).
//        - bounced    -> estado_entrega='rebotado' + aviso alta/normal
//                        (según tipo_email) + añadida a
//                        direcciones_email_suprimidas.
//        - complained -> estado_entrega='quejado' + aviso + SUPRIMIDA (no
//                        se le vuelve a escribir: seguir mandando a quien
//                        marca como spam daña la reputación del dominio).
//        - suppressed -> estado_entrega='suprimido' + aviso + suprimida
//                        (Resend ya la tenía en SU lista; se replica aquí
//                        para no depender de su dashboard y no malgastar
//                        intentos futuros).
//      El resto de tipos (sent/opened/clicked/delivery_delayed/failed/
//      scheduled/received) se sigue archivando sin tocar nada más, igual
//      que antes.
//   2. VERIFICACIÓN DE FIRMA REAL (antes: solo se comprobaba que el
//      timestamp estuviera a menos de 5 minutos — sin ninguna
//      verificación criptográfica, cualquiera que conociera la URL podía
//      insertar eventos falsos). Ahora: HMAC-SHA256 sobre
//      "{svix-id}.{svix-timestamp}.{cuerpo crudo}" con la clave derivada
//      de RESEND_WEBHOOK_SECRET (prefijo whsec_ + base64), comparación en
//      tiempo constante — ver firma.ts, PUNTO MÁS DELICADO del encargo:
//      si esto se implementa mal, el webhook deja de recibir eventos y
//      nadie se entera (los eventos simplemente dejarían de llegar).
//      Probado en producción tras desplegar: ver informe de esta entrega
//      para la evidencia (envío real a delivered@resend.dev, evento
//      confirmado en `email_eventos` DESPUÉS del cambio).
//
// RESILIENCIA A PROPÓSITO: el INSERT en `email_eventos` sigue siendo
// INCONDICIONAL y el PRIMER paso tras verificar la firma — es la garantía
// mínima de este encargo (nunca depende de que la migración de esta
// entrega ya esté aplicada). Todo lo nuevo (actuarSobreEnvio) va en un
// try/catch que nunca tumba la respuesta 200: si la migración con las
// columnas/tabla nuevas aún no se ha aplicado, el UPDATE fallará con
// "column does not exist", se registrará en el log, y el evento se queda
// igualmente archivado — no se pierde nada, solo se retrasa el
// enriquecimiento hasta que alguien aplique la migración (este encargo
// prohíbe aplicarla desde aquí; ver cabecera de la migración).
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

// Tipos de eventos de Resend
interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: {
    // email_id/from/to solo vienen en los eventos email.*; los contact.*
    // traen id/email/unsubscribed (ver newsletter.ts).
    email_id?: string;
    from?: string;
    to?: string[];
    id?: string;
    email?: string;
    unsubscribed?: boolean;
    tags?: unknown;
    broadcast_id?: string;
    subject?: string;
    created_at?: string;
    click?: {
      link: string;
      timestamp: string;
    };
    bounce?: {
      message: string;
    };
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verificar método
    if (req.method !== "POST") {
      console.log("Método no permitido:", req.method);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Obtener headers de Svix para verificación
    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");

    console.log("Webhook recibido:", { svixId, svixTimestamp, hasSignature: !!svixSignature });

    // Cuerpo CRUDO — necesario tal cual para la verificación de firma (ver
    // firma.ts: el HMAC se calcula sobre estos bytes exactos, nunca sobre
    // un JSON.stringify del objeto ya parseado) y se reutiliza después
    // para el JSON.parse de abajo, sin volver a leer el stream.
    const body = await req.text();

    // ------------------------------------------------------------------
    // VERIFICACIÓN DE FIRMA (real, criptográfica) — ver firma.ts para el
    // formato exacto y por qué. Se hace ANTES de parsear el JSON: no tiene
    // sentido procesar un cuerpo que no se puede confiar que viene de
    // Resend. Mismo criterio que antes (solo se exige si hay secreto
    // configurado, para no romper un entorno de desarrollo sin
    // RESEND_WEBHOOK_SECRET) pero ahora FALLA CERRADO de verdad: antes,
    // si faltaban las cabeceras svix con el secreto configurado, el
    // código solo avisaba por log y DEJABA PASAR el evento sin verificar
    // nada — ese hueco queda cerrado aquí (verificarWebhookResend ya
    // rechaza por "faltan_cabeceras_svix").
    // ------------------------------------------------------------------
    const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");
    if (webhookSecret) {
      const cabeceras: CabecerasSvix = { svixId, svixTimestamp, svixSignature };
      const resultadoFirma = await verificarWebhookResend(webhookSecret, cabeceras, body);
      if (!resultadoFirma.valido) {
        console.error("[resend-webhook] Firma rechazada:", resultadoFirma.motivo);
        return jsonResponse({ error: "invalid_signature", motivo: resultadoFirma.motivo }, 401);
      }
      console.log("[resend-webhook] Firma verificada correctamente");
    } else {
      console.warn("[resend-webhook] RESEND_WEBHOOK_SECRET no configurado — aceptando SIN verificar firma (solo debería pasar en desarrollo)");
    }

    // Parsear el body (ya lo tenemos como texto crudo, arriba)
    let event: ResendWebhookEvent;
    try {
      event = JSON.parse(body);
    } catch (e) {
      console.error("Error parseando JSON:", e);
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    console.log("Evento recibido:", {
      type: event.type,
      email_id: event.data?.email_id,
      to: event.data?.to,
      created_at: event.created_at,
    });

    // Crear cliente de Supabase con service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Variables de entorno de Supabase no configuradas");
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Mapear tipo de evento a nombre corto
    const tipoEvento = event.type.replace("email.", ""); // sent, delivered, opened, clicked, bounced, complained, suppressed...

    // Preparar metadata adicional
    const metadata: Record<string, unknown> = {
      from: event.data.from,
      subject: event.data.subject,
    };

    if (event.data.click) {
      metadata.click_link = event.data.click.link;
      metadata.click_timestamp = event.data.click.timestamp;
    }

    if (event.data.bounce) {
      metadata.bounce_message = event.data.bounce.message;
    }

    // Broadcasts (newsletter por Resend Marketing): para contar entregas,
    // aperturas, clics y rebotes por envío (newsletter_estadisticas_broadcasts).
    const broadcastId = broadcastIdDe(event);
    if (broadcastId) {
      metadata.broadcast_id = broadcastId;
    }

    // Insertar evento en la base de datos — INCONDICIONAL, primer paso de
    // I/O, ANTES de intentar enriquecer nada (ver cabecera: es la garantía
    // mínima de este encargo, no depende de la migración de esta entrega).
    const { data, error } = await supabase
      .from("email_eventos")
      .insert({
        email_id: idArchivoEvento(event),
        tipo_evento: tipoEvento,
        email_destinatario: destinatarioArchivo(event),
        timestamp_evento: event.created_at,
        metadata: metadata,
      })
      .select()
      .single();

    if (error) {
      console.error("Error insertando evento:", error);
      return jsonResponse({ error: "Database error", details: error.message }, 500);
    }

    console.log("Evento guardado exitosamente:", data.id);

    // ------------------------------------------------------------------
    // NUEVO — actuar sobre el evento (punto 1 del encargo, "que el
    // webhook actúe sobre lo que recibe, en vez de solo archivarlo").
    // Todo lo de aquí abajo es best-effort: cualquier fallo se registra en
    // el log pero NUNCA cambia la respuesta 200 (el evento ya quedó
    // archivado arriba, que es lo que este encargo exige poder demostrar
    // incluso sin la migración aplicada).
    // ------------------------------------------------------------------
    const estadoEntrega = mapearEventoAEstadoEntrega(tipoEvento);
    let envioEnlazado = false;
    let avisoCreado = false;

    if (estadoEntrega && event.data.email_id) {
      try {
        const resultadoAccion = await actuarSobreEnvio(supabase, event.data.email_id, estadoEntrega, event.data);
        envioEnlazado = resultadoAccion.envioEnlazado;
        avisoCreado = resultadoAccion.avisoCreado;
      } catch (err) {
        console.error(
          "[resend-webhook] Error actuando sobre el evento (el evento ya está archivado en email_eventos, no se pierde):",
          err instanceof Error ? err.message : err,
        );
      }
    }

    // ------------------------------------------------------------------
    // BAJA AUTOMÁTICA DEL NEWSLETTER (2026-10-03, ver newsletter.ts): queja
    // de spam, rebote permanente, supresión de Resend o baja en la página de
    // Resend -> newsletter_suscriptores.activo = false con fecha y origen.
    // Best-effort como lo de arriba: nunca cambia la respuesta 200.
    // ------------------------------------------------------------------
    let bajaNewsletter = 0;
    const decisionBaja = decidirBajaNewsletter(event);
    if (decisionBaja) {
      try {
        bajaNewsletter = await darDeBajaNewsletter(supabase, decisionBaja);
      } catch (err) {
        console.error("[resend-webhook] Error dando de baja del newsletter (evento ya archivado):", err instanceof Error ? err.message : err);
      }
    }

    // contact.deleted: solo se desvincula el contacto (no es una baja; ver newsletter.ts).
    const contactoBorrado = decidirDesvinculoContacto(event);
    if (contactoBorrado) {
      try {
        const { error: errDesvinculo } = await supabase
          .from("newsletter_suscriptores")
          .update({ resend_contact_id: null })
          .eq("resend_contact_id", contactoBorrado);
        if (errDesvinculo) {
          console.error("[resend-webhook] No se pudo desvincular el contacto borrado (¿migración 20261003193000 sin aplicar?):", errDesvinculo.message);
        }
      } catch (err) {
        console.error("[resend-webhook] Error desvinculando contacto borrado:", err instanceof Error ? err.message : err);
      }
    }

    return jsonResponse({
      success: true,
      event_id: data.id,
      baja_newsletter: bajaNewsletter,
      tipo: tipoEvento,
      estado_entrega: estadoEntrega,
      envio_enlazado: envioEnlazado,
      aviso_creado: avisoCreado,
    });
  } catch (error: unknown) {
    console.error("Error procesando webhook:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: "Internal server error", message: errorMessage }, 500);
  }
});

// ==============================================================================
// ACTUAR SOBRE EL ENVÍO — enlaza el evento con su fila de envios_email_reserva
// (por resend_id), la marca, y si toca (bounced/complained/suppressed) avisa
// al personal y añade la dirección a direcciones_email_suprimidas.
// ==============================================================================

interface ResultadoAccion {
  envioEnlazado: boolean;
  avisoCreado: boolean;
}

function motivoSupresion(estado: EstadoEntrega): "bounced" | "complained" | "suppressed" | null {
  if (estado === "rebotado") return "bounced";
  if (estado === "quejado") return "complained";
  if (estado === "suprimido") return "suppressed";
  return null;
}

function detalleParaEstado(estado: EstadoEntrega, data: ResendWebhookEvent["data"]): string | null {
  if (estado === "rebotado" && data.bounce?.message) return data.bounce.message;
  return null;
}

async function actuarSobreEnvio(
  supabase: SupabaseClient,
  emailId: string,
  estado: EstadoEntrega,
  eventData: ResendWebhookEvent["data"],
): Promise<ResultadoAccion> {
  // 1) Localizar la fila de envios_email_reserva que mandó este correo.
  //    `.order + .limit(1)` en vez de un `.eq(...).single()` a secas: no
  //    hay constraint UNIQUE sobre resend_id (ver migración de esta
  //    entrega) y ante cualquier duda se prefiere no reventar la petición
  //    por una coincidencia inesperada — se actúa sobre la más reciente.
  const { data: envio, error: errEnvio } = await supabase
    .from("envios_email_reserva")
    .select("id, reserva_id, tipo_email, destinatario")
    .eq("resend_id", emailId)
    .order("creado_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (errEnvio) {
    console.error(`[resend-webhook] Error buscando envio por resend_id=${emailId}:`, errEnvio.message);
    return { envioEnlazado: false, avisoCreado: false };
  }
  if (!envio) {
    // Normal y esperado para correos que no son de reservas (enviar-newsletter,
    // notify-config-bot-change...) — email_eventos es genérica para
    // cualquier remitente (ver comentario original de la tabla).
    console.log(`[resend-webhook] email_id=${emailId} sin fila en envios_email_reserva (no es de una reserva, o no coincide todavía) — solo archivado.`);
    return { envioEnlazado: false, avisoCreado: false };
  }

  // 2) Marcar la fila — best-effort: si la migración de esta entrega
  //    (columnas estado_entrega/estado_entrega_at/estado_entrega_detalle)
  //    todavía no está aplicada, esto falla con "column does not exist" y
  //    se registra, pero NO impide avisar/suprimir más abajo (mejor avisar
  //    sin marcar la fila que ni avisar ni marcar).
  const detalle = detalleParaEstado(estado, eventData);
  const { error: errUpdate } = await supabase
    .from("envios_email_reserva")
    .update({ estado_entrega: estado, estado_entrega_at: new Date().toISOString(), estado_entrega_detalle: detalle })
    .eq("id", envio.id);
  if (errUpdate) {
    console.error(`[resend-webhook] No se pudo marcar estado_entrega en envio ${envio.id} (¿migración sin aplicar?):`, errUpdate.message);
  }

  if (!debeAvisarPersonal(estado)) {
    // "entregado": confirmación silenciosa, sin aviso (punto 1 del encargo).
    return { envioEnlazado: true, avisoCreado: false };
  }

  // 3) Suprimir la dirección — best-effort, upsert por email normalizado.
  const motivo = motivoSupresion(estado);
  if (debeSuprimirDireccion(estado) && motivo && envio.destinatario) {
    const { error: errSupresion } = await supabase.from("direcciones_email_suprimidas").upsert(
      {
        email: envio.destinatario.toLowerCase().trim(),
        motivo,
        detalle,
        origen_email_id: emailId,
        actualizado_at: new Date().toISOString(),
      },
      { onConflict: "email" },
    );
    if (errSupresion) {
      console.error(`[resend-webhook] No se pudo registrar la supresión de ${envio.destinatario}:`, errSupresion.message);
    }
  }

  // 4) Datos del cliente para el aviso — best-effort, un aviso sin
  //    teléfono/nombre sigue siendo mejor que ningún aviso.
  let nombreCliente: string | null = null;
  let telefono: string | null = null;
  let email: string | null = null;
  let fecha: string | null = null;
  let hora: string | null = null;
  if (envio.reserva_id) {
    const { data: reserva, error: errReserva } = await supabase
      .from("reservas")
      .select("nombre, telefono, email, fecha, hora")
      .eq("id", envio.reserva_id)
      .maybeSingle();
    if (errReserva) {
      console.error(`[resend-webhook] No se pudieron leer datos de la reserva ${envio.reserva_id} para el aviso:`, errReserva.message);
    } else if (reserva) {
      nombreCliente = reserva.nombre;
      telefono = reserva.telefono;
      email = reserva.email;
      fecha = reserva.fecha;
      hora = reserva.hora;
    }
  }

  const mensaje = construirMensajeAvisoWebhook({ estado, tipoEmail: envio.tipo_email, nombreCliente, telefono, email, fecha, hora });
  if (!mensaje) return { envioEnlazado: true, avisoCreado: false };

  // 5) Margen anti-aluvión — propio carril (origen=resend_webhook +
  //    prioridad), igual patrón que avisarEnviosDefinitivamentePerdidos en
  //    emails-reserva/index.ts (comprobación + insert no atómicos: mismo
  //    trade-off ya asumido allí, una carrera muy ajustada podría colar un
  //    aviso de más, nunca es una cuota de facturación).
  const prioridad = prioridadAvisoWebhook(envio.tipo_email);
  const ahora = new Date().toISOString();
  const { data: ultimo, error: errUltimo } = await supabase
    .from("notificaciones_dashboard")
    .select("created_at")
    .eq("tipo", "email_fallido")
    .eq("origen", ORIGEN_RESEND_WEBHOOK)
    .eq("prioridad", prioridad)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (errUltimo) {
    console.error("[resend-webhook] Error comprobando el último aviso (se avisa igualmente):", errUltimo.message);
  } else if (!debeCrearAvisoWebhook((ultimo?.created_at as string | undefined) ?? null, ahora)) {
    console.log(`[resend-webhook] Aviso omitido por cooldown (origen=${ORIGEN_RESEND_WEBHOOK}, prioridad=${prioridad}).`);
    return { envioEnlazado: true, avisoCreado: false };
  }

  const { error: errInsert } = await supabase.from("notificaciones_dashboard").insert({
    tipo: "email_fallido",
    origen: ORIGEN_RESEND_WEBHOOK,
    prioridad,
    titulo: mensaje.titulo,
    mensaje: mensaje.mensaje,
    referencia_id: envio.reserva_id,
    referencia_tipo: "reserva",
  });
  if (errInsert) {
    console.error("[resend-webhook] Error creando aviso:", errInsert.message);
    return { envioEnlazado: true, avisoCreado: false };
  }

  return { envioEnlazado: true, avisoCreado: true };
}

// ==============================================================================
// BAJA DEL NEWSLETTER — RPC newsletter_registrar_baja (migración
// 20261003171500: compara el email sin mayúsculas y solo toca filas activas).
// Si la migración aún no está aplicada, cae a un UPDATE directo (por id si el
// correo traía la etiqueta `suscriptor`, si no por email sin distinguir
// mayúsculas: ILIKE con los comodines escapados, como la RPC) — puede que
// el CHECK de origen_baja todavía no acepte el valor nuevo y falle: se queda en
// el log y el evento archivado, igual que el resto de este webhook.
// ==============================================================================

async function darDeBajaNewsletter(supabase: SupabaseClient, d: DecisionBajaNewsletter): Promise<number> {
  const { data: filas, error } = await supabase.rpc("newsletter_registrar_baja", {
    p_email: d.email,
    p_origen: d.origen,
    p_suscriptor_id: d.suscriptorId,
  });
  if (!error) {
    const n = typeof filas === "number" ? filas : 0;
    if (n > 0) console.log(`[resend-webhook] Newsletter: ${n} suscriptor(es) dado(s) de baja (origen=${d.origen}).`);
    return n;
  }

  console.error("[resend-webhook] RPC newsletter_registrar_baja no disponible (¿migración 20261003171500 sin aplicar?):", error.message);
  const ahora = new Date().toISOString();
  let consulta = supabase
    .from("newsletter_suscriptores")
    .update({ activo: false, fecha_baja: ahora, origen_baja: d.origen })
    .eq("activo", true);
  if (d.suscriptorId) {
    consulta = consulta.eq("id", d.suscriptorId);
  } else {
    const patron = patronIlikeExacto(d.email);
    if (patron === null) {
      console.error("[resend-webhook] Email con «*»: sin la RPC no se puede buscar sin riesgo; no se da de baja a nadie.");
      return 0;
    }
    consulta = consulta.ilike("email", patron);
  }
  const { data: actualizadas, error: errUpdate } = await consulta.select("id");
  if (errUpdate) {
    console.error("[resend-webhook] No se pudo dar de baja del newsletter:", errUpdate.message);
    return 0;
  }
  return actualizadas?.length ?? 0;
}
