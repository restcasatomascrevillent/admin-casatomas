import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NewsletterRequest {
  asunto: string;
  mensaje: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY no está configurada");
    }

    const resend = new Resend(resendApiKey);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { asunto, mensaje }: NewsletterRequest = await req.json();

    if (!asunto || !mensaje) {
      throw new Error("Asunto y mensaje son requeridos");
    }

    // Obtener suscriptores activos
    const { data: suscriptores, error: suscriptoresError } = await supabase
      .from("newsletter_suscriptores")
      .select("email, nombre")
      .eq("activo", true);

    if (suscriptoresError) {
      throw new Error(`Error al obtener suscriptores: ${suscriptoresError.message}`);
    }

    if (!suscriptores || suscriptores.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: "No hay suscriptores activos" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Enviar emails en lotes de 50
    const batchSize = 50;
    let enviados = 0;
    let errores = 0;

    for (let i = 0; i < suscriptores.length; i += batchSize) {
      const batch = suscriptores.slice(i, i + batchSize);
      
      const promises = batch.map(async (suscriptor) => {
        try {
          await resend.emails.send({
            from: "Newsletter <onboarding@resend.dev>",
            to: [suscriptor.email],
            subject: asunto,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                ${suscriptor.nombre ? `<p>Hola ${suscriptor.nombre},</p>` : "<p>Hola,</p>"}
                <div style="white-space: pre-wrap;">${mensaje}</div>
                <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;" />
                <p style="font-size: 12px; color: #666;">
                  Si no deseas recibir más correos, puedes darte de baja contactándonos.
                </p>
              </div>
            `,
          });
          return true;
        } catch (error) {
          console.error(`Error enviando a ${suscriptor.email}:`, error);
          return false;
        }
      });

      const results = await Promise.all(promises);
      enviados += results.filter(Boolean).length;
      errores += results.filter((r) => !r).length;
    }

    // Obtener el usuario que envió (desde el token de autorización)
    const authHeader = req.headers.get("Authorization");
    let userId = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id;
    }

    // Registrar el envío en el historial
    await supabase.from("newsletter_envios").insert({
      asunto,
      mensaje,
      total_destinatarios: enviados,
      enviado_por: userId,
    });

    console.log(`Newsletter enviado: ${enviados} exitosos, ${errores} errores`);

    return new Response(
      JSON.stringify({
        success: true,
        enviados,
        errores,
        total: suscriptores.length,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error en enviar-newsletter:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
