import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirUsuario } from "../_shared/autorizacion.ts";
const createClient = clienteConAuditoria(createClientBase, "registrar-metrica");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Único evento que manda el panel (src/hooks/useAuth.tsx). */
export const EVENTOS_PERMITIDOS = new Set(["inicio_sesion"]);

Deno.serve(conAuditoriaDePeticion("registrar-metrica", createClientBase, async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Cada usuario registra SU propio inicio de sesión (lo llama useAuth al
  // entrar, para cualquier cuenta, tenga o no secciones): basta con un usuario
  // real. Lo que no se acepta es el usuario del body (CT-REM-FN-02).
  const auth = await exigirUsuario(req, { crearCliente: createClient, corsHeaders });
  if (!auth.ok) return auth.response;

  try {
    // `usuario_id` y `usuario_email` del body se IGNORAN: salen del JWT.
    const cuerpo = await req.json().catch(() => null);
    const evento = cuerpo?.evento;
    const metadata = cuerpo?.metadata;
    if (!EVENTOS_PERMITIDOS.has(evento)) {
      return new Response(JSON.stringify({ error: "Evento no permitido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const metadataSegura = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      && JSON.stringify(metadata).length <= 2000 ? metadata : {};

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
      usuario_id: auth.userId,
      fecha: new Date().toISOString(),
      entidad_tipo: "usuario",
      entidad_id: auth.email,
      metadata: metadataSegura,
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
  } catch (err: unknown) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
