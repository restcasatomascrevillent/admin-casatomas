import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirAdmin } from "../_shared/autorizacion.ts";
const createClient = clienteConAuditoria(createClientBase, "leer-metricas");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export const LIMITE_MAXIMO = 500;

Deno.serve(conAuditoriaDePeticion("leer-metricas", createClientBase, async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Guarda los emails de login de todo el personal: solo admin o super admin
  // (CT-REM-FN-02). 401 sin usuario, 403 sin rol, 503 si no se puede comprobar.
  const auth = await exigirAdmin(req, { crearCliente: createClient, corsHeaders });
  if (!auth.ok) return auth.response;

  try {
    const metricsUrl = "https://yfnrkmxnmtrqmdtfvqix.supabase.co";
    const metricsKey = Deno.env.get("METRICS_SUPABASE_SERVICE_ROLE_KEY");

    if (!metricsKey) {
      throw new Error("METRICS_SUPABASE_SERVICE_ROLE_KEY not configured");
    }

    const metricsClient = createClient(metricsUrl, metricsKey);

    // Parse query params
    const url = new URL(req.url);
    const tabla = url.searchParams.get("tabla") || "metricas";
    // Tope de filas por petición (antes sin límite).
    const pedido = parseInt(url.searchParams.get("limite") || "100", 10);
    const limite = Number.isFinite(pedido) ? Math.min(Math.max(pedido, 1), LIMITE_MAXIMO) : 100;
    const tipo = url.searchParams.get("tipo");
    const desde = url.searchParams.get("desde");
    const hasta = url.searchParams.get("hasta");

    // Whitelist de tablas permitidas
    const tablasPermitidas = ["metricas"];
    if (!tablasPermitidas.includes(tabla)) {
      return new Response(JSON.stringify({ error: "Tabla no permitida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let query = metricsClient.from(tabla).select("*").order("fecha", { ascending: false }).limit(limite);

    if (tipo) {
      query = query.eq("tipo", tipo);
    }
    if (desde) {
      query = query.gte("fecha", desde);
    }
    if (hasta) {
      query = query.lte("fecha", hasta);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error reading metrics:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ data, count: data?.length || 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
