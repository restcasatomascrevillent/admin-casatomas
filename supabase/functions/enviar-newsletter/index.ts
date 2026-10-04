import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { baseBajaWeb, urlBajaWeb } from "../newsletter-baja/enlace-web.ts";
import {
  validarPayload,
  renderNewsletter,
  asuntoNewsletter,
  cabecerasBaja,
  tieneEnlaceBaja,
  limiteTransaccional,
} from "./plantillas.ts";
import { comprobarPermisoNewsletter, type ClientePermiso } from "./permiso.ts";
import { enviarBroadcast, puedeEnviarBroadcast } from "./broadcast.ts";
import { crearRegistroEnvios } from "./registro.ts";
import { enviarPrueba, payloadDePrueba } from "./prueba.ts";
import {
  canalNewsletter,
  limiteContactos,
  remitenteNewsletter,
  NOMBRE_SEGMENTO_NEWSLETTER,
} from "../_shared/resend-marketing/config.ts";
import { ClienteResendMarketing } from "../_shared/resend-marketing/cliente.ts";
import { RepositorioNewsletterResend } from "../_shared/resend-marketing/repositorio.ts";
import { sincronizarConCerrojo } from "../_shared/resend-marketing/servicio.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// Remitente. Antes estaba fijo a "onboarding@resend.dev" (sandbox de Resend:
// solo entrega al dueño de la cuenta, y como el SDK v2 devuelve el error en vez
// de lanzarlo, el panel decía "enviado" sin que llegara a nadie). Ahora:
// NEWSLETTER_FROM_EMAIL (remitente propio para marketing, si se configura) ->
// RESEND_FROM_EMAIL (el de los correos de reserva, dominio ya verificado) ->
// sandbox como último recurso.
const NEWSLETTER_FROM = remitenteNewsletter(Deno.env.get("NEWSLETTER_FROM_EMAIL"), Deno.env.get("RESEND_FROM_EMAIL"));

// Canal (fase 2, docs/funcionalidades/newsletter-resend-marketing.md):
//   NEWSLETTER_CANAL=broadcast     -> un Broadcast de Resend Marketing al Segment
//                                    del newsletter (cuenta contactos, no correos).
//   cualquier otro valor / sin él  -> el envío transaccional de siempre (por
//                                    defecto: desplegar no cambia nada).
const NEWSLETTER_CANAL = canalNewsletter(Deno.env.get("NEWSLETTER_CANAL"));

// Tiempo que se deja a la sincronización previa al Broadcast (la función tiene
// ~150 s de reloj; el resto es para crear y enviar el Broadcast).
const MS_SYNC_ANTES_DE_ENVIAR = 90_000;

// ============================================================================
// Firma HMAC para los enlaces de baja (RGPD)
// ----------------------------------------------------------------------------
// El enlace de baja ya no lleva el email en claro en la query string (antes
// apuntaba a un webhook de n8n con ?email=... y sin firmar: cualquiera podía
// dar de baja a cualquier suscriptor, y los prefetchers de los clientes de
// correo disparaban bajas fantasma sin que nadie hiciera clic).
// Ahora se firma "<id_suscriptor>:<via>" con HMAC-SHA256 y se verifica en
// supabase/functions/newsletter-baja, que es quien ejecuta la baja real.
// Misma implementación duplicada allí a propósito (este proyecto no usa un
// directorio _shared/ entre funciones).
// ============================================================================

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(sigBuf));
}

// Plantillas, escape del HTML, pie de baja obligatorio y validación: en
// ./plantillas.ts (código puro que también usa la vista previa del panel).

// ==================== FUNCIÓN PRINCIPAL ====================

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // --------------------------------------------------------------------------
  // Autenticación + permiso de la sección Marketing. Antes bastaba con estar
  // autenticado: cualquier usuario del panel (cocina, sala...) podía mandar un
  // correo a toda la lista. Ahora se exige can_write_section('marketing'),
  // la misma función que usan las políticas RLS de newsletter_suscriptores.
  // Se llama con un cliente "del usuario" (su JWT), porque can_write_section()
  // resuelve auth.uid() de la llamada (mismo patrón que emails-reserva).
  // --------------------------------------------------------------------------
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ success: false, error: 'Unauthorized' }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  // Cast estructural: ClientePermiso describe solo auth.getUser() y rpc() del cliente (ver permiso.ts).
  const permiso = await comprobarPermisoNewsletter(supabaseUser as unknown as ClientePermiso);
  if (!permiso.ok) {
    console.warn(`enviar-newsletter: petición rechazada (${permiso.status}): ${permiso.error}`);
    return json({ success: false, error: permiso.error }, permiso.status);
  }
  const user = { id: permiso.userId };

  try {
    let cuerpo: unknown;
    try {
      cuerpo = await req.json();
    } catch {
      return json({ success: false, error: 'Cuerpo de la petición no válido' }, 400);
    }
    // Prueba segura por Resend Marketing (ver prueba.ts): a un Segment que solo
    // tiene la dirección de prueba (delivered@resend.dev). Nunca a clientes.
    // Los datos de la prueba vienen anidados en `newsletter` (ver payloadDePrueba).
    const prueba = payloadDePrueba(cuerpo);
    const validacion = validarPayload(prueba ?? cuerpo);
    if (!validacion.ok) return json({ success: false, error: validacion.error }, 400);
    const datos = validacion.datos;

    if (prueba !== null) {
      return await enviarPruebaBroadcast(datos, user.id);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const registro = crearRegistroEnvios(supabase);

    if (NEWSLETTER_CANAL === "broadcast") {
      return await enviarPorBroadcast(supabase, registro, datos, user.id);
    }

    // ---------------- Canal transaccional (el de siempre) ----------------
    // Solo activos: un dado de baja NUNCA recibe envíos.
    const { data: activos, error: dbError } = await supabase
      .from("newsletter_suscriptores")
      .select("id, email, nombre")
      .eq("activo", true);

    if (dbError) {
      console.error('Database error:', dbError);
      return json({ success: false, error: 'Error al obtener suscriptores' }, 500);
    }

    // Tampoco a direcciones que Resend rechazó o que marcaron spam en un correo
    // de reserva (direcciones_email_suprimidas, la rellena resend-webhook).
    // Best-effort: si la tabla no existe todavía, se envía igual.
    let suprimidas = new Set<string>();
    const { data: filasSuprimidas, error: supError } = await supabase
      .from("direcciones_email_suprimidas")
      .select("email");
    if (supError) {
      console.warn('enviar-newsletter: no se pudo leer direcciones_email_suprimidas:', supError.message);
    } else {
      suprimidas = new Set((filasSuprimidas ?? []).map((f: { email: string }) => f.email.toLowerCase().trim()));
    }
    const suscriptores = (activos ?? []).filter((s) => !suprimidas.has(s.email.toLowerCase().trim()));

    if (suscriptores.length === 0) {
      return json({ success: false, error: 'No hay suscriptores activos' }, 400);
    }

    // Protección de la cuota transaccional (ver limiteTransaccional en plantillas.ts).
    const limite = limiteTransaccional(Deno.env.get('NEWSLETTER_LIMITE_TRANSACCIONAL'));
    if (limite !== null && suscriptores.length > limite) {
      return json({
        success: false,
        error: `Hay ${suscriptores.length} suscriptores y el envío directo está limitado a ${limite} para no agotar la cuota diaria de correos de Resend que comparten las reservas. Hay que enviarlo como Broadcast de Resend Marketing (secret NEWSLETTER_CANAL=broadcast, ver docs/funcionalidades/newsletter-resend-marketing.md) o, si el plan de Resend es de pago, subir NEWSLETTER_LIMITE_TRANSACCIONAL.`,
      }, 409);
    }

    console.log(`enviar-newsletter: tipo=${datos.tipo}, destinatarios=${suscriptores.length}, usuario=${user.id}`);

    // Secreto para firmar los enlaces de baja. Si no se configura un secreto
    // dedicado (NEWSLETTER_UNSUB_SECRET), se usa la service role key: nunca se
    // expone al cliente y ya se trata como secreto en este mismo proyecto.
    const unsubSecret = Deno.env.get('NEWSLETTER_UNSUB_SECRET') || serviceKey;
    const newsletterBajaUrl = `${supabaseUrl}/functions/v1/newsletter-baja`;
    // Página de baja en la web de Casa Tomás: Supabase sirve el HTML de
    // *.supabase.co como text/plain (ver newsletter-baja/enlace-web.ts).
    const bajaWebUrl = baseBajaWeb(Deno.env.get('NEWSLETTER_BAJA_WEB_URL'));

    const subject = asuntoNewsletter(datos.tipo, datos.titulo);

    const resultados: { email: string; success: boolean; error?: string }[] = [];

    for (const suscriptor of suscriptores) {
      try {
        // Enlace de baja del pie (clic -> página de confirmación en la web).
        const sigBody = await hmacSign(`${suscriptor.id}:body`, unsubSecret);
        const enlaceBaja = urlBajaWeb(bajaWebUrl, suscriptor.id, 'body', sigBody);

        // Cabecera List-Unsubscribe (RFC 8058 "one-click": Gmail/Outlook/Yahoo
        // hacen POST directo y la baja es inmediata, sin página intermedia).
        const sigHeader = await hmacSign(`${suscriptor.id}:header`, unsubSecret);
        const urlOneClick = `${newsletterBajaUrl}?sid=${suscriptor.id}&via=header&sig=${sigHeader}`;

        const html = renderNewsletter(datos, enlaceBaja);
        // Defensa en profundidad: sin pie de baja, ese correo no sale.
        if (!tieneEnlaceBaja(html, enlaceBaja)) {
          throw new Error('pie_baja_ausente');
        }

        const envio = {
          from: NEWSLETTER_FROM,
          to: [suscriptor.email],
          subject,
          html,
          headers: cabecerasBaja(urlOneClick),
          // Etiquetas para que resend-webhook sepa a qué suscriptor dar de baja
          // si este correo rebota o lo marcan como spam (ver resend-webhook/newsletter.ts).
          tags: [
            { name: 'categoria', value: 'newsletter' },
            { name: 'suscriptor', value: suscriptor.id },
          ],
        };

        // El SDK v2 de Resend DEVUELVE el error (no lo lanza): antes se daba por
        // enviado cualquier correo, también los que Resend rechazaba.
        let { error } = await resend.emails.send(envio);
        if (error && /rate|429/i.test(`${error.name ?? ''} ${error.message ?? ''}`)) {
          // Límite de 10 peticiones/s por equipo (compartido con las reservas):
          // se espera un segundo y se reintenta una vez.
          await esperar(1100);
          ({ error } = await resend.emails.send(envio));
        }
        if (error) throw new Error(error.message || error.name || 'Error de Resend');

        resultados.push({ email: suscriptor.email, success: true });
      } catch (emailError: unknown) {
        const errorMsg = emailError instanceof Error ? emailError.message : 'Unknown error';
        console.error(`enviar-newsletter: fallo enviando a ${suscriptor.id}:`, errorMsg);
        resultados.push({ email: suscriptor.email, success: false, error: errorMsg });
      }
    }

    const exitosos = resultados.filter(r => r.success).length;
    const fallidos = resultados.filter(r => !r.success).length;

    console.log(`Newsletter sent: ${exitosos} success, ${fallidos} failed`);

    // Historial del envío (un fallo aquí no tumba la respuesta; ver registro.ts).
    await registro.insertar({
      asunto: subject,
      mensaje: datos.mensaje,
      total_destinatarios: suscriptores.length,
      enviado_por: user.id,
      tipo_newsletter: datos.tipo,
      estado: fallidos === 0 ? 'completado' : (exitosos === 0 ? 'fallido' : 'parcial'),
      canal: 'transaccional',
    });

    if (exitosos === 0) {
      return json({
        success: false,
        error: 'No se pudo enviar a ningún suscriptor (revisa el remitente y el dominio verificado en Resend)',
        total: suscriptores.length,
        exitosos,
        fallidos,
        detalles: resultados.filter(r => !r.success),
      }, 502);
    }

    return json({
      success: true,
      canal: 'transaccional',
      message: `Newsletter enviado a ${exitosos} suscriptores`,
      total: suscriptores.length,
      exitosos,
      fallidos,
      detalles: fallidos > 0 ? resultados.filter(r => !r.success) : undefined,
    });

  } catch (error: unknown) {
    console.error('Error processing newsletter:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return json({ success: false, error: errorMessage }, 500);
  }
});

// ============================================================================
// CANAL BROADCAST (Resend Marketing) — ver broadcast.ts y
// ../_shared/resend-marketing/{sync,servicio}.ts
// ----------------------------------------------------------------------------
// 1. Sincroniza la tabla con Resend DENTRO del cerrojo (bajas a Resend fuera,
//    altas dentro del Segment, bajas hechas en la página de Resend a la tabla).
// 2. Si la pasada deja algo que podría hacer llegar el correo a un dado de baja
//    (puedeEnviarBroadcast), no envía nada.
// 3. Crea el Broadcast (borrador), lo apunta en newsletter_envios y lo envía.
// ============================================================================

async function enviarPorBroadcast(
  // deno-lint-ignore no-explicit-any
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any -- mismo cliente que el resto de index.ts
  registro: ReturnType<typeof crearRegistroEnvios>,
  datos: Parameters<typeof enviarBroadcast>[0]["datos"],
  usuarioId: string,
): Promise<Response> {
  const apiKey = Deno.env.get("RESEND_MARKETING_API_KEY");
  if (!apiKey) {
    console.error("enviar-newsletter: NEWSLETTER_CANAL=broadcast pero falta RESEND_MARKETING_API_KEY");
    return json({ success: false, error: "Falta configurar RESEND_MARKETING_API_KEY (clave de Resend con Full access) para enviar como Broadcast" }, 500);
  }

  const cliente = new ClienteResendMarketing({ apiKey });
  const repo = new RepositorioNewsletterResend(supabase);
  const limite = limiteContactos(Deno.env.get("NEWSLETTER_LIMITE_CONTACTOS"));

  const resultado = await sincronizarConCerrojo(
    {
      repo,
      cliente,
      origen: "envio",
      usuarioId,
      segmentIdConfigurado: Deno.env.get("RESEND_NEWSLETTER_SEGMENT_ID"),
      nombreSegmento: NOMBRE_SEGMENTO_NEWSLETTER,
      hastaMs: Date.now() + MS_SYNC_ANTES_DE_ENVIAR,
    },
    async (resumen) => {
      const veredicto = puedeEnviarBroadcast(resumen, limite);
      if (!veredicto.ok) return { veredicto, envio: null };
      const envio = await enviarBroadcast({
        cliente,
        registro,
        datos,
        from: NEWSLETTER_FROM,
        replyTo: Deno.env.get("NEWSLETTER_REPLY_TO") || null,
        segmentId: resumen.segmentId!,
        destinatarios: resumen.destinatarios ?? 0,
        usuarioId,
      });
      return { veredicto, envio };
    },
  );

  if (resultado.tipo === "ocupado") {
    return json({ success: false, error: "Ahora mismo se está sincronizando con Resend (o enviando otro newsletter). Espera un minuto y vuelve a intentarlo." }, 409);
  }
  if (resultado.tipo === "error") {
    console.error("enviar-newsletter: no se pudo iniciar la sincronización:", resultado.mensaje);
    return json({ success: false, error: resultado.mensaje }, 500);
  }

  const { resumen, extra } = resultado;
  console.log(
    `enviar-newsletter[broadcast]: sync ${resumen.estado} (altas=${resumen.altas}, borrados=${resumen.borrados}, bajas_resend=${resumen.bajasResend}, errores=${resumen.errores.length}, pendientes=${resumen.pendientes}), usuario=${usuarioId}`,
  );
  if (!extra || !extra.veredicto.ok) {
    const v = extra?.veredicto;
    const status = v && !v.ok ? v.status : 500;
    return json({ success: false, canal: "broadcast", error: v && !v.ok ? v.error : "No se pudo preparar el envío" }, status);
  }
  const envio = extra.envio!;
  if (!envio.ok) {
    console.error(`enviar-newsletter[broadcast]: fallo (${envio.status}) broadcast=${envio.broadcastId ?? "-"}: ${envio.error}`);
    return json({ success: false, canal: "broadcast", error: envio.error, broadcast_id: envio.broadcastId ?? null }, envio.status);
  }

  const n = resumen.destinatarios ?? 0;
  console.log(`enviar-newsletter[broadcast]: enviado broadcast=${envio.broadcastId} a ${n} contactos`);
  return json({
    success: true,
    canal: "broadcast",
    message: `Newsletter enviado como Broadcast de Resend a ${n} suscriptores`,
    total: n,
    exitosos: n,
    fallidos: 0,
    broadcast_id: envio.broadcastId,
    sincronizacion: { altas: resumen.altas, borrados: resumen.borrados, bajas_resend: resumen.bajasResend, errores: resumen.errores.length },
  });
}

async function enviarPruebaBroadcast(datos: Parameters<typeof enviarPrueba>[0]["datos"], usuarioId: string): Promise<Response> {
  const apiKey = Deno.env.get("RESEND_MARKETING_API_KEY");
  if (!apiKey) {
    return json({ success: false, error: "Falta configurar RESEND_MARKETING_API_KEY (clave de Resend con Full access) para la prueba por Resend Marketing" }, 500);
  }
  const r = await enviarPrueba({
    cliente: new ClienteResendMarketing({ apiKey }),
    datos,
    from: NEWSLETTER_FROM,
    emailPrueba: Deno.env.get("NEWSLETTER_EMAIL_PRUEBA"),
    segmentPruebaConfigurado: Deno.env.get("RESEND_NEWSLETTER_SEGMENT_ID_PRUEBA"),
    segmentNewsletterConfigurado: Deno.env.get("RESEND_NEWSLETTER_SEGMENT_ID"),
  });
  if (!r.ok) {
    console.error(`enviar-newsletter[prueba]: fallo (${r.status}): ${r.error}`);
    return json({ success: false, prueba: true, error: r.error }, r.status);
  }
  console.log(`enviar-newsletter[prueba]: broadcast=${r.broadcastId} segment=${r.segmentId} usuario=${usuarioId}`);
  return json({
    success: true,
    prueba: true,
    message: `Prueba enviada como Broadcast a ${r.destinatario} (no llega a ningún cliente). Mírala en Resend → Broadcasts.`,
    broadcast_id: r.broadcastId,
    total: 1,
    exitosos: 1,
    fallidos: 0,
  });
}
