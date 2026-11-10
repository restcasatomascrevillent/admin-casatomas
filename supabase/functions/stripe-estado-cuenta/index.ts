import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@23.0.0";

/**
 * Estado de la cuenta de Stripe para la pestaña "Stripe" de Cheques: si
 * puede cobrar, si tiene los payouts activados y si la clave configurada es
 * de test o de producción (live). Nunca expone la clave secreta al
 * navegador, y nunca pide ni guarda CIF o IBAN — esos datos solo existen en
 * el propio onboarding de Stripe (dashboard.stripe.com), no aquí.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "No autorizado" }, 401);

  // La pestaña Stripe es solo para «Editar» en Cheques (o super admin) desde el
  // 10/11/2026 (migración 20261122164100): antes bastaba con «Ver».
  const { data: puedeEditar, error: permError } = await userClient.rpc("can_edit_section", { _section: "cheques" });
  if (permError || !puedeEditar) return json({ error: "No tienes permiso para consultar Stripe: hace falta «Editar» en Cheques" }, 403);

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!STRIPE_SECRET_KEY) return json({ configurado: false });

  try {
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2026-09-30.endive", httpClient: Stripe.createFetchHttpClient() });
    const cuenta = await stripe.accounts.retrieve();
    return json({
      configurado: true,
      // sk_live_/rk_live_ = producción; sk_test_/rk_test_ = pruebas. Solo se
      // mira el prefijo, la clave en sí nunca sale de esta función.
      modo: /^[sr]k_live_/.test(STRIPE_SECRET_KEY) ? "live" : "test",
      pais: cuenta.country ?? null,
      moneda_por_defecto: cuenta.default_currency ?? null,
      cobros_activos: !!cuenta.charges_enabled,
      payouts_activos: !!cuenta.payouts_enabled,
      detalles_completos: !!cuenta.details_submitted,
      nombre_negocio: cuenta.business_profile?.name ?? null,
    });
  } catch (error) {
    console.error("[stripe-estado-cuenta]", error);
    return json({ configurado: true, error: "No se pudo consultar Stripe. Revisa la clave configurada." }, 502);
  }
});
