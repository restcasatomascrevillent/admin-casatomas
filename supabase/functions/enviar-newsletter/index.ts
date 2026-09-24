import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { baseBajaWeb, urlBajaWeb } from "../newsletter-baja/enlace-web.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

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

interface NewsletterPayload {
  tipo: 'anuncio' | 'nuevo_menu' | 'oferta';
  titulo: string;
  mensaje: string;
  imagen_url?: string;
}

// ==================== PLANTILLAS HTML ====================

const plantillaAnuncio = (titulo: string, mensaje: string, unsubscribeLink: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #555555; }
    .container { background-color: #ffffff; max-width: 600px; margin: 40px auto; box-shadow: 0 5px 15px rgba(0,0,0,0.08); }
    .header { background-color: #363e45; padding: 30px; text-align: center; }
    .brand-name { font-family: 'Georgia', serif; color: #ffffff; font-size: 26px; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
    .brand-subtitle { color: #c49a6c; font-size: 10px; text-transform: uppercase; letter-spacing: 3px; margin-top: 5px; display: block; }
    .content { padding: 40px; line-height: 1.8; font-size: 16px; color: #363e45; }
    .footer { background-color: #f9f9f9; padding: 20px; font-size: 12px; color: #888; text-align: center; border-top: 1px solid #eee; }
    a { color: #363e45; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="brand-name">Casa Tomás</h1>
      <span class="brand-subtitle">Comunicado Oficial</span>
    </div>
    <div class="content">
      <h2 style="color: #c49a6c; margin-top: 0; font-family: 'Georgia', serif;">${titulo}</h2>
      <p style="white-space: pre-line;">${mensaje}</p>
      <p style="margin-top: 30px; font-style: italic;">
        Atentamente,<br>
        <strong>La Dirección de Casa Tomás</strong>
      </p>
    </div>
    <div class="footer">
      <p>C/ Santa María de la Cabeza, 2, Crevillente | Tel: 966 10 78 87</p>
      <p><a href="${unsubscribeLink}">Dejar de recibir estos avisos</a></p>
    </div>
  </div>
</body>
</html>`;

const plantillaNuevoMenu = (titulo: string, mensaje: string, imagenUrl: string | undefined, unsubscribeLink: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #555555; }
    .container { background-color: #ffffff; max-width: 600px; margin: 40px auto; box-shadow: 0 5px 15px rgba(0,0,0,0.08); border-top: 5px solid #c49a6c; }
    .header { background-color: #ffffff; padding: 40px 20px 20px; text-align: center; border-bottom: 1px solid #f0f0f0; }
    .brand-name { font-family: 'Georgia', serif; color: #363e45; font-size: 28px; margin: 0; text-transform: uppercase; }
    .content { padding: 40px; line-height: 1.6; }
    .menu-box { background-color: #fffcf5; border: 1px solid #eaddcf; padding: 30px; margin: 20px 0; text-align: center; }
    .menu-title { color: #c49a6c; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; font-size: 14px; margin-bottom: 20px; display: block; }
    .menu-text { white-space: pre-line; color: #555; font-style: italic; font-size: 16px; line-height: 2; }
    .btn-gold { display: inline-block; background-color: #363e45; color: #fff !important; padding: 12px 30px; text-decoration: none; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; font-size: 13px; margin-top: 20px; }
    .footer { background-color: #363e45; padding: 30px; font-size: 12px; color: #aaa; text-align: center; }
    .footer a { color: #fff; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="brand-name">Casa Tomás</h1>
      <p style="color: #999; text-transform: uppercase; font-size: 11px; letter-spacing: 2px; margin-top: 5px;">Gastronomía & Tradición</p>
    </div>
    <div class="content">
      ${imagenUrl ? `<img src="${imagenUrl}" style="width: 100%; height: auto; display: block; margin-bottom: 30px; border-radius: 2px;" alt="Nuevo plato">` : ''}
      <h2 style="text-align: center; color: #363e45; margin-bottom: 10px;">${titulo}</h2>
      <div class="menu-box">
        <span class="menu-title">Propuesta Gastronómica</span>
        <div class="menu-text">${mensaje}</div>
      </div>
      <div style="text-align: center;">
        <a href="https://restaurantecasatomascrevillente.es/reservar" class="btn-gold">Reservar Mesa</a>
      </div>
    </div>
    <div class="footer">
      <p>Casa Tomás Crevillente</p>
      <p><a href="${unsubscribeLink}">Darse de baja</a></p>
    </div>
  </div>
</body>
</html>`;

const plantillaOferta = (titulo: string, mensaje: string, imagenUrl: string | undefined, unsubscribeLink: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; background-color: #222; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; }
    .container { background-color: #ffffff; max-width: 600px; margin: 0 auto; }
    .hero { background-color: #363e45; color: #ffffff; padding: 40px; text-align: center; }
    .brand-name { font-family: 'Georgia', serif; font-size: 24px; margin-bottom: 20px; display: block; }
    .offer-badge { display: inline-block; background-color: #c49a6c; color: #fff; padding: 5px 15px; text-transform: uppercase; font-size: 12px; font-weight: bold; letter-spacing: 1px; margin-bottom: 15px; }
    .content { padding: 40px; text-align: center; }
    .btn-cta { display: inline-block; background-color: #c49a6c; color: #ffffff !important; padding: 15px 40px; text-decoration: none; font-size: 18px; font-weight: bold; border-radius: 4px; margin-top: 20px; box-shadow: 0 4px 10px rgba(196, 154, 108, 0.4); }
    .footer { background-color: #f4f4f4; padding: 20px; font-size: 11px; color: #888; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    ${imagenUrl ? `<img src="${imagenUrl}" style="width: 100%; height: auto; display: block;" alt="Oferta Especial">` : ''}
    <div class="hero">
      <span class="brand-name">Casa Tomás</span>
      <h1 style="margin: 0; font-size: 28px; line-height: 1.2;">${titulo}</h1>
    </div>
    <div class="content">
      <span class="offer-badge">Promoción Exclusiva</span>
      <p style="font-size: 18px; color: #555; line-height: 1.6; margin-bottom: 30px;">${mensaje}</p>
      <a href="https://restaurantecasatomascrevillente.es/reservar" class="btn-cta">APROVECHAR OFERTA</a>
    </div>
    <div class="footer">
      <p>Oferta válida según disponibilidad.</p>
      <p><a href="${unsubscribeLink}" style="color: #888;">No quiero recibir más ofertas</a></p>
    </div>
  </div>
</body>
</html>`;

// ==================== FUNCIÓN PRINCIPAL ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
    authHeader.replace('Bearer ', '')
  );
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload: NewsletterPayload = await req.json();
    
    console.log('Newsletter payload received:', JSON.stringify(payload, null, 2));

    // Validar campos requeridos
    if (!payload.tipo || !payload.titulo || !payload.mensaje) {
      console.error('Missing required fields');
      return new Response(
        JSON.stringify({ success: false, error: 'Campos requeridos: tipo, titulo, mensaje' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Crear cliente Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Obtener suscriptores activos
    const { data: suscriptores, error: dbError } = await supabase
      .from("newsletter_suscriptores")
      .select("id, email, nombre")
      .eq("activo", true);

    if (dbError) {
      console.error('Database error:', dbError);
      return new Response(
        JSON.stringify({ success: false, error: 'Error al obtener suscriptores' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!suscriptores || suscriptores.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No hay suscriptores activos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Sending newsletter to ${suscriptores.length} subscribers`);

    // Secreto para firmar los enlaces de baja. Si no se configura un secreto
    // dedicado (NEWSLETTER_UNSUB_SECRET), se usa la service role key: nunca se
    // expone al cliente y ya se trata como secreto en este mismo proyecto.
    const unsubSecret = Deno.env.get('NEWSLETTER_UNSUB_SECRET') || supabaseKey;
    const newsletterBajaUrl = `${supabaseUrl}/functions/v1/newsletter-baja`;
    // Página de baja en la web de Casa Tomás: Supabase sirve el HTML de
    // *.supabase.co como text/plain (ver newsletter-baja/enlace-web.ts).
    const bajaWebUrl = baseBajaWeb(Deno.env.get('NEWSLETTER_BAJA_WEB_URL'));

    // Determinar asunto según tipo
    let subject = payload.titulo;
    if (payload.tipo === 'nuevo_menu') {
      subject = `🍽️ ${payload.titulo}`;
    } else if (payload.tipo === 'oferta') {
      subject = `🎉 ${payload.titulo}`;
    }

    // Enviar emails
    const resultados: { email: string; success: boolean; error?: string }[] = [];
    
    for (const suscriptor of suscriptores) {
      try {
        // Enlace de baja para el pie del email (clic humano -> página de confirmación)
        const sigBody = await hmacSign(`${suscriptor.id}:body`, unsubSecret);
        const unsubscribeLink = urlBajaWeb(bajaWebUrl, suscriptor.id, 'body', sigBody);

        // Enlace para la cabecera List-Unsubscribe (RFC 8058, "one-click": Gmail y
        // Outlook hacen POST directo a esta URL sin pasar por la página de confirmación).
        // Se queda en la función: un GET a ella redirige a la web.
        const sigHeader = await hmacSign(`${suscriptor.id}:header`, unsubSecret);
        const listUnsubscribeUrl = `${newsletterBajaUrl}?sid=${suscriptor.id}&via=header&sig=${sigHeader}`;

        // Generar HTML según tipo
        let html: string;
        switch (payload.tipo) {
          case 'anuncio':
            html = plantillaAnuncio(payload.titulo, payload.mensaje, unsubscribeLink);
            break;
          case 'nuevo_menu':
            html = plantillaNuevoMenu(payload.titulo, payload.mensaje, payload.imagen_url, unsubscribeLink);
            break;
          case 'oferta':
            html = plantillaOferta(payload.titulo, payload.mensaje, payload.imagen_url, unsubscribeLink);
            break;
          default:
            html = plantillaAnuncio(payload.titulo, payload.mensaje, unsubscribeLink);
        }

        // Enviar con Resend
        // NOTA: "onboarding@resend.dev" es el sandbox de Resend y solo entrega al dueño
        // de la cuenta. Pendiente del dueño: verificar un dominio propio en Resend y
        // cambiar el "from" (ver informe).
        const emailResponse = await resend.emails.send({
          from: "Casa Tomás <onboarding@resend.dev>", // Cambiar a tu dominio verificado
          to: [suscriptor.email],
          subject: subject,
          html: html,
          headers: {
            "List-Unsubscribe": `<${listUnsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });

        console.log(`Email sent to ${suscriptor.email}:`, emailResponse);
        resultados.push({ email: suscriptor.email, success: true });

      } catch (emailError: unknown) {
        const errorMsg = emailError instanceof Error ? emailError.message : 'Unknown error';
        console.error(`Error sending to ${suscriptor.email}:`, errorMsg);
        resultados.push({ email: suscriptor.email, success: false, error: errorMsg });
      }
    }

    // Contar éxitos y fallos
    const exitosos = resultados.filter(r => r.success).length;
    const fallidos = resultados.filter(r => !r.success).length;

    console.log(`Newsletter sent: ${exitosos} success, ${fallidos} failed`);

    // Registrar el envío en el historial. Antes esta tabla nunca se escribía
    // (existía desde el principio, pero enviar-newsletter no insertaba en ella),
    // así que el panel de estadísticas no tenía forma de mostrar envíos pasados.
    // Un fallo aquí no tumba la respuesta: el email ya se ha enviado igualmente.
    try {
      const estado = fallidos === 0 ? 'completado' : (exitosos === 0 ? 'fallido' : 'parcial');
      const { error: envioError } = await supabase.from('newsletter_envios').insert({
        asunto: subject,
        mensaje: payload.mensaje,
        total_destinatarios: suscriptores.length,
        enviado_por: user.id,
        tipo_newsletter: payload.tipo,
        estado,
      });
      if (envioError) {
        console.error('No se pudo registrar el envío en newsletter_envios:', envioError);
      }
    } catch (logError) {
      console.error('Error registrando historial de newsletter_envios:', logError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Newsletter enviado a ${exitosos} suscriptores`,
        total: suscriptores.length,
        exitosos,
        fallidos,
        detalles: fallidos > 0 ? resultados.filter(r => !r.success) : undefined
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error processing newsletter:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
