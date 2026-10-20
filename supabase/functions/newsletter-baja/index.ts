import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { baseBajaWeb, urlBajaWeb, quiereJson, respuestaBaja, type EstadoBaja } from "./enlace-web.ts";
import { quitarDeResendTrasBaja } from "./resend.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
const createClient = clienteConAuditoria(createClientBase, "newsletter-baja");

// ============================================================================
// newsletter-baja
// ----------------------------------------------------------------------------
// Baja REAL de suscriptores del newsletter (RGPD).
//
// Sustituye al workflow de n8n "Newsletter", que solo respondía una página
// HTML de "baja confirmada" sin tocar la base de datos: el suscriptor creía
// haberse dado de baja y seguía recibiendo correos. Además el enlace era un
// GET sin firmar con el email en claro en la query (?email=...), así que
// cualquiera podía dar de baja a cualquier otro, y los prefetchers/escáneres
// de seguridad de los clientes de correo (que siguen enlaces GET automática-
// mente) provocaban bajas fantasma sin que nadie hiciera clic.
//
// Flujo nuevo:
//   - GET  ?sid=<id_suscriptor>&via=header|body&sig=<hmac>
//       Solo LEE. Verifica la firma y, si el suscriptor sigue activo, muestra
//       una página de confirmación. No modifica nada, así que un prefetch no
//       da de baja a nadie por accidente.
//   - POST (misma query string)
//       Es el único método que ejecuta la baja de verdad. Lo dispara:
//         a) el formulario de la página de confirmación (clic humano), o
//         b) el botón "Cancelar suscripción" nativo de Gmail/Outlook, que
//            hace POST directo al soportar la cabecera List-Unsubscribe-Post
//            (RFC 8058, unsubscribe "one-click").
//
// El token no lleva el email en claro: solo el id del suscriptor + un HMAC-
// SHA256 sobre "<id>:<via>" firmado con NEWSLETTER_UNSUB_SECRET (o, si no se
// configura, con SUPABASE_SERVICE_ROLE_KEY como fallback). Sin el secreto no
// se puede forjar una firma válida: no vale con adivinar o iterar ids.
//
// PÁGINA EN LA WEB (2026-09-24, ver enlace-web.ts): Supabase sirve el HTML de
// *.supabase.co como text/plain, así que la página de baja la sirve ahora
// casa-tomas-story (/newsletter/baja) y llama aquí con `formato=json`. Un GET
// sin `formato=json` (enlaces ya enviados) redirige 302 a esa página. El POST
// "one-click" de Gmail/Outlook sigue igual.
//
// enviar-newsletter/index.ts es quien genera estos enlaces al enviar cada
// newsletter (mismo HMAC, duplicado ahí a propósito: este proyecto no usa un
// directorio _shared/ entre funciones, así que se sigue esa misma convención).
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SITE_URL = "https://restaurantecasatomascrevillente.es";
const BAJA_WEB_URL = baseBajaWeb(Deno.env.get("NEWSLETTER_BAJA_WEB_URL"));

// ---------------------------------------------------------------------------
// Firma HMAC
// ---------------------------------------------------------------------------

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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(sid: string, via: string, sig: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(`${sid}:${via}`, secret);
  return timingSafeEqual(expected, sig);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Plantilla HTML — adaptada de la página "Baja Confirmada" del workflow n8n
// "Newsletter" (misma tarjeta, colores de marca y botón de volver a la web).
// Ahora tiene 3 estados según el paso del flujo en vez de uno solo.
// ---------------------------------------------------------------------------

function pageShell(icon: string, title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Casa Tomás</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f4f4f4;
      font-family: 'Segoe UI', Helvetica, Arial, sans-serif;
      color: #555;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .card {
      background-color: #ffffff;
      width: 100%;
      max-width: 480px;
      padding: 40px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.05);
      text-align: center;
      border-top: 4px solid #8c847d;
      margin: 20px;
      box-sizing: border-box;
    }
    .brand-name {
      font-family: 'Georgia', serif;
      color: #363e45;
      font-size: 24px;
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .icon { font-size: 40px; margin: 20px 0; }
    h1 { font-size: 20px; color: #363e45; margin-bottom: 15px; }
    p { line-height: 1.6; font-size: 15px; margin: 0 0 20px; color: #777; }
    .meta { font-size: 12px; color: #aaa; margin-top: -10px; }
    .btn-primary, .btn-secondary {
      display: inline-block;
      padding: 12px 25px;
      text-decoration: none;
      font-weight: 600;
      border-radius: 3px;
      font-size: 14px;
      border: none;
      cursor: pointer;
      margin: 6px;
      font-family: inherit;
    }
    .btn-primary { background-color: #c49a6c; color: #ffffff; }
    .btn-primary:hover { background-color: #b0885a; }
    .btn-secondary { background-color: transparent; color: #777; text-decoration: underline; }
    .social-links { margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
    .social-text { font-size: 12px; color: #999; margin-bottom: 10px; }
    .social-icon { color: #363e45; text-decoration: none; margin: 0 8px; font-size: 14px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand-name">Casa Tomás</div>
    <div class="icon">${icon}</div>
    <h1>${escapeHtml(title)}</h1>
    ${bodyHtml}
    <div class="social-links">
      <div class="social-text">Aunque no recibas emails, síguenos en redes:</div>
      <a href="#" class="social-icon">Instagram</a> &bull;
      <a href="#" class="social-icon">Facebook</a>
    </div>
  </div>
</body>
</html>`;
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function renderConfirmPage(email: string, sid: string, via: string, sig: string): string {
  const qs = `sid=${encodeURIComponent(sid)}&via=${encodeURIComponent(via)}&sig=${encodeURIComponent(sig)}`;
  return pageShell(
    "🤔",
    "¿Seguro que quieres darte de baja?",
    `
    <p>Vamos a eliminar <strong>${escapeHtml(email)}</strong> de nuestra lista de noticias y ofertas.
    Si tienes alguna reserva, seguirás recibiendo su confirmación igualmente.</p>
    <form method="POST" action="?${qs}">
      <button type="submit" class="btn-primary">Confirmar baja</button>
    </form>
    <a href="${SITE_URL}" class="btn-secondary">No, quiero seguir recibiendo correos</a>
    `,
  );
}

function renderDonePage(email: string, fechaBaja: string, yaEstaba: boolean): string {
  const fechaTexto = new Date(fechaBaja).toLocaleString("es-ES", {
    dateStyle: "long",
    timeStyle: "short",
  });
  const mensaje = yaEstaba
    ? `Tu correo <strong>${escapeHtml(email)}</strong> ya estaba dado de baja de nuestra lista de noticias y ofertas.`
    : `Tu correo <strong>${escapeHtml(email)}</strong> ha sido eliminado correctamente de nuestra lista de noticias y ofertas.`;
  return pageShell(
    "👋",
    "Te echaremos de menos",
    `
    <p>${mensaje}</p>
    <p class="meta">Baja registrada el ${escapeHtml(fechaTexto)}.</p>
    <a href="${SITE_URL}?utm_source=unsubscribe_page" class="btn-primary" style="text-decoration:none;">Volver a la web</a>
    `,
  );
}

function renderInvalidPage(): string {
  return pageShell(
    "⚠️",
    "Enlace no válido",
    `
    <p>Este enlace de baja no es válido o ha caducado. Si quieres dejar de recibir nuestros correos,
    usa el enlace del último email que hayas recibido de nosotros.</p>
    <a href="${SITE_URL}" class="btn-primary" style="text-decoration:none;">Volver a la web</a>
    `,
  );
}

function renderErrorPage(): string {
  return pageShell(
    "⚠️",
    "Ha ocurrido un error",
    `
    <p>No hemos podido procesar tu solicitud. Inténtalo de nuevo en unos minutos.</p>
    <a href="${SITE_URL}" class="btn-primary" style="text-decoration:none;">Volver a la web</a>
    `,
  );
}

// ---------------------------------------------------------------------------

serve(conAuditoriaDePeticion("newsletter-baja", createClientBase, async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const sid = url.searchParams.get("sid");
  const viaParam = url.searchParams.get("via");
  const via = viaParam === "header" ? "header" : "body";
  const sig = url.searchParams.get("sig");
  const modoJson = quiereJson(url);

  // Navegador abriendo un enlace ya enviado: a la página de la web (no muta).
  if (req.method === "GET" && !modoJson) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: urlBajaWeb(BAJA_WEB_URL, sid ?? "", via, sig ?? ""),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  // Respuesta según el modo: JSON para la web, HTML para el one-click.
  const responder = (estado: EstadoBaja, html: string, status: number, email?: string, fechaBaja?: string) =>
    modoJson
      ? new Response(JSON.stringify(respuestaBaja(estado, email ?? null, fechaBaja ?? null)), {
          // 200 también en inválido: la web lee el estado del cuerpo.
          status: status >= 500 ? status : 200,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        })
      : htmlResponse(html, status);

  const secret = Deno.env.get("NEWSLETTER_UNSUB_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!secret || !supabaseUrl || !serviceKey) {
    console.error("newsletter-baja: faltan variables de entorno (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    return responder("error", renderErrorPage(), 500);
  }

  if (!sid || !sig || !UUID_RE.test(sid) || !(await verifySignature(sid, via, sig, secret))) {
    return responder("invalido", renderInvalidPage(), 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: suscriptor, error: fetchError } = await supabase
    .from("newsletter_suscriptores")
    .select("id, email, activo, fecha_baja")
    .eq("id", sid)
    .maybeSingle();

  if (fetchError) {
    console.error("newsletter-baja: error consultando suscriptor:", fetchError);
    return responder("error", renderErrorPage(), 500);
  }

  if (!suscriptor) {
    // Firma válida pero el suscriptor ya no existe (borrado manual, etc.)
    return responder("invalido", renderInvalidPage(), 404);
  }

  if (req.method === "GET") {
    // Solo llega aquí en modo JSON (el GET de navegador ya se redirigió).
    if (!suscriptor.activo) {
      const fecha = suscriptor.fecha_baja ?? new Date().toISOString();
      return responder("ya_estaba", renderDonePage(suscriptor.email, fecha, true), 200, suscriptor.email, fecha);
    }
    return responder("confirmar", renderConfirmPage(suscriptor.email, sid, via, sig), 200, suscriptor.email);
  }

  // POST: acción real de baja (idempotente si ya estaba dado de baja)
  if (!suscriptor.activo) {
    const fecha = suscriptor.fecha_baja ?? new Date().toISOString();
    return responder("ya_estaba", renderDonePage(suscriptor.email, fecha, true), 200, suscriptor.email, fecha);
  }

  const origen = via === "header" ? "cabecera_one_click" : "enlace_email";
  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("newsletter_suscriptores")
    .update({ activo: false, fecha_baja: nowIso, origen_baja: origen })
    .eq("id", sid);

  if (updateError) {
    console.error("newsletter-baja: error al dar de baja:", updateError);
    return responder("error", renderErrorPage(), 500);
  }

  console.log(`newsletter-baja: suscriptor ${sid} dado de baja (origen=${origen})`);

  // Fase 2 (Resend Marketing): fuera de Resend también. Best-effort y en
  // segundo plano (EdgeRuntime.waitUntil) para no retrasar la respuesta; si
  // falla, la próxima sincronización lo arregla (ver resend.ts).
  const quitar = quitarDeResendTrasBaja({
    apiKey: Deno.env.get("RESEND_MARKETING_API_KEY"),
    email: suscriptor.email,
    suscriptorId: sid,
  });
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(quitar);
  else await quitar;

  return responder("baja_hecha", renderDonePage(suscriptor.email, nowIso, false), 200, suscriptor.email, nowIso);
}));
