import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { evento, usuario_email, usuario_id, metadata } = await req.json();

    const metricsUrl = "https://yfnrkmxnmtrqmdtfvqix.supabase.co";
    const metricsKey = Deno.env.get("METRICS_SUPABASE_SERVICE_ROLE_KEY");

    if (!metricsKey) {
      throw new Error("METRICS_SUPABASE_SERVICE_ROLE_KEY not configured");
    }

    const metricsClient = createClient(metricsUrl, metricsKey);

    const { error } = await metricsClient.from("metricas").insert({
      tipo: evento,
      valor: 1,
      unidad: "login",
      usuario_id,
      fecha: new Date().toISOString(),
      entidad_tipo: "usuario",
      entidad_id: usuario_email,
      metadata: metadata || {},
    });

    if (error) {
      console.error("Error inserting metric:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
