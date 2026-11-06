import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { comprobarPermisoSeccion, SECCION_MARKETING, type ClientePermiso } from "../_shared/permiso-marketing.ts";
import { canalNewsletter, limiteContactos, NOMBRE_SEGMENTO_NEWSLETTER } from "../_shared/resend-marketing/config.ts";
import { ClienteResendMarketing } from "../_shared/resend-marketing/cliente.ts";
import { RepositorioNewsletterResend } from "../_shared/resend-marketing/repositorio.ts";
import { sincronizarConCerrojo } from "../_shared/resend-marketing/servicio.ts";
import { autenticar, construirEstado, leerAccion, respuestaSincronizacion } from "./peticion.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
const createClient = clienteConAuditoria(createClientBase, "newsletter-sync-resend");

// ============================================================================
// newsletter-sync-resend
// ----------------------------------------------------------------------------
// Copia newsletter_suscriptores (la fuente de verdad) a Resend Marketing y trae
// de vuelta las bajas hechas en la página de Resend. La lógica está en
// ../_shared/resend-marketing/sync.ts (ver su cabecera); aquí solo hay I/O.
//
//   POST {"accion":"sincronizar"}   panel (permiso de escritura en Marketing)
//                                   o cron (x-webhook-secret)
//   POST {"accion":"estado"} / GET  panel (permiso de lectura en Marketing):
//                                   canal actual, configuración, última pasada
//
// Secrets:
//   RESEND_MARKETING_API_KEY        clave de Resend con "Full access" (Contacts y
//                                   Broadcasts no funcionan con "Sending access")
//   RESEND_NEWSLETTER_SEGMENT_ID    opcional: id del Segment. Sin él se busca el
//                                   Segment "Newsletter Casa Tomás" y, si no
//                                   existe, se crea (el id sale en la respuesta
//                                   y en newsletter_sincronizaciones_resend).
//   NEWSLETTER_SYNC_CRON_SECRET     para el cron diario (falla cerrado sin él)
//   NEWSLETTER_LIMITE_CONTACTOS     opcional (1.000 por defecto, plan gratuito)
//   NEWSLETTER_CANAL                solo para mostrarlo en el panel (lo usa enviar-newsletter)
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/** La función tiene ~150 s de reloj: a los 100 s deja de empezar acciones nuevas y lo que falte queda para la siguiente pasada. */
const MS_PRESUPUESTO = 100_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(conAuditoriaDePeticion("newsletter-sync-resend", createClientBase, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);

  const inicio = Date.now();
  let cuerpo: unknown = null;
  if (req.method === "POST") {
    const texto = await req.text();
    if (texto.trim()) {
      try {
        cuerpo = JSON.parse(texto);
      } catch {
        return json({ success: false, error: "Cuerpo de la petición no válido" }, 400);
      }
    }
  }
  const accion = leerAccion(req.method, cuerpo);
  if (!accion) return json({ success: false, error: "accion no válida (estado | sincronizar)" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const auth = await autenticar(req.headers, accion, {
    secretoCron: Deno.env.get("NEWSLETTER_SYNC_CRON_SECRET") ?? "",
    comprobarUsuario: (modo) => {
      const supabaseUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      });
      return comprobarPermisoSeccion(
        supabaseUser as unknown as ClientePermiso,
        SECCION_MARKETING,
        modo,
        modo === "leer" ? "No tienes permiso para ver el newsletter" : "No tienes permiso para sincronizar el newsletter (hace falta «Editar» en Newsletter)",
      );
    },
  });
  if (!auth.ok) {
    if (auth.status === 500) console.error("[newsletter-sync] NEWSLETTER_SYNC_CRON_SECRET no configurado — llamada de cron rechazada (falla cerrado)");
    return json({ success: false, error: auth.error }, auth.status);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const repo = new RepositorioNewsletterResend(supabase);
  const apiKey = Deno.env.get("RESEND_MARKETING_API_KEY") ?? "";
  const limite = limiteContactos(Deno.env.get("NEWSLETTER_LIMITE_CONTACTOS"));

  if (accion === "estado") {
    try {
      const [ultima, ultimaTerminada] = await Promise.all([repo.ultimaPasada(false), repo.ultimaPasada(true)]);
      return json({
        success: true,
        ...construirEstado({
          canal: canalNewsletter(Deno.env.get("NEWSLETTER_CANAL")),
          apiKey: Boolean(apiKey),
          segmentIdEnv: Deno.env.get("RESEND_NEWSLETTER_SEGMENT_ID") ?? null,
          cronSecret: Boolean(Deno.env.get("NEWSLETTER_SYNC_CRON_SECRET")),
          limite,
          ultima,
          ultimaTerminada,
        }),
      });
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      console.error("[newsletter-sync] estado:", mensaje);
      return json({ success: false, error: mensaje }, 500);
    }
  }

  // accion === "sincronizar"
  if (!apiKey) {
    return json({ success: false, error: "Falta configurar RESEND_MARKETING_API_KEY (clave de Resend con Full access)" }, 500);
  }

  try {
    const resultado = await sincronizarConCerrojo({
      repo,
      cliente: new ClienteResendMarketing({ apiKey }),
      origen: auth.origen === "cron" ? "cron" : "panel",
      usuarioId: auth.usuarioId,
      segmentIdConfigurado: Deno.env.get("RESEND_NEWSLETTER_SEGMENT_ID"),
      nombreSegmento: NOMBRE_SEGMENTO_NEWSLETTER,
      hastaMs: inicio + MS_PRESUPUESTO,
    });

    if (resultado.tipo === "ocupado") {
      return json({ success: false, error: "Ya hay una sincronización (o un envío) en curso. Espera un minuto." }, 409);
    }
    if (resultado.tipo === "error") {
      console.error("[newsletter-sync] no se pudo empezar:", resultado.mensaje);
      return json({ success: false, error: resultado.mensaje }, 500);
    }

    const r = resultado.resumen;
    console.log(
      `[newsletter-sync] origen=${auth.origen} estado=${r.estado} altas=${r.altas} nombres=${r.actualizados} segmento+=${r.anadidosSegmento} segmento-=${r.quitadosSegmento} borrados=${r.borrados} bajas_resend=${r.bajasResend} errores=${r.errores.length} pendientes=${r.pendientes} peticiones=${r.peticiones} ms=${Date.now() - inicio}`,
    );
    return json(respuestaSincronizacion(r, resultado.pasadaId, limite), r.estado === "error" ? 502 : 200);
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    console.error("[newsletter-sync] error inesperado:", mensaje);
    return json({ success: false, error: mensaje }, 500);
  }
}));
