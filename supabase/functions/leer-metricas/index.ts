import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
    authHeader.replace("Bearer ", "")
  );
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
    const limite = parseInt(url.searchParams.get("limite") || "100");
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
});
