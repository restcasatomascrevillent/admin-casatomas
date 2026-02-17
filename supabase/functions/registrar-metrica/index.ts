import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { evento, usuario_email, usuario_id, metadata } = await req.json();

    const metricsUrl = Deno.env.get("METRICS_SUPABASE_URL") || "https://yfnrkmxnmtrqmdtfvqix.supabase.co";
    const metricsKey = Deno.env.get("METRICS_SUPABASE_SERVICE_ROLE_KEY");

    if (!metricsKey) {
      throw new Error("METRICS_SUPABASE_SERVICE_ROLE_KEY not configured");
    }

    const metricsClient = createClient(metricsUrl, metricsKey);

    const { error } = await metricsClient.from("metricas_uso").insert({
      evento,
      usuario_email,
      usuario_id,
      metadata,
      created_at: new Date().toISOString(),
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
