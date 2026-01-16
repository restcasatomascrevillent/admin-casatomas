import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

// Tipos de eventos de Resend
interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject?: string;
    created_at?: string;
    click?: {
      link: string;
      timestamp: string;
    };
    bounce?: {
      message: string;
    };
  };
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verificar método
    if (req.method !== "POST") {
      console.log("Método no permitido:", req.method);
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Obtener headers de Svix para verificación
    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");

    console.log("Webhook recibido:", { svixId, svixTimestamp, hasSignature: !!svixSignature });

    // Parsear el body
    const body = await req.text();
    let event: ResendWebhookEvent;
    
    try {
      event = JSON.parse(body);
    } catch (e) {
      console.error("Error parseando JSON:", e);
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Evento recibido:", {
      type: event.type,
      email_id: event.data?.email_id,
      to: event.data?.to,
      created_at: event.created_at
    });

    // Verificar firma si está configurada
    const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");
    if (webhookSecret && svixId && svixTimestamp && svixSignature) {
      // Verificación básica de timestamp (previene replay attacks)
      const timestampSeconds = parseInt(svixTimestamp);
      const now = Math.floor(Date.now() / 1000);
      const tolerance = 300; // 5 minutos
      
      if (Math.abs(now - timestampSeconds) > tolerance) {
        console.error("Timestamp fuera de rango:", { svixTimestamp, now });
        return new Response(
          JSON.stringify({ error: "Timestamp out of tolerance" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      console.log("Verificación de timestamp pasada");
    } else if (webhookSecret) {
      console.warn("Webhook recibido sin headers de Svix, pero hay secret configurado");
    }

    // Crear cliente de Supabase con service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Variables de entorno de Supabase no configuradas");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Mapear tipo de evento a nombre corto
    const tipoEvento = event.type.replace("email.", ""); // sent, delivered, opened, clicked, bounced, complained

    // Preparar metadata adicional
    const metadata: Record<string, unknown> = {
      from: event.data.from,
      subject: event.data.subject,
    };

    if (event.data.click) {
      metadata.click_link = event.data.click.link;
      metadata.click_timestamp = event.data.click.timestamp;
    }

    if (event.data.bounce) {
      metadata.bounce_message = event.data.bounce.message;
    }

    // Insertar evento en la base de datos
    const { data, error } = await supabase
      .from("email_eventos")
      .insert({
        email_id: event.data.email_id,
        tipo_evento: tipoEvento,
        email_destinatario: event.data.to?.[0] || null,
        timestamp_evento: event.created_at,
        metadata: metadata,
      })
      .select()
      .single();

    if (error) {
      console.error("Error insertando evento:", error);
      return new Response(
        JSON.stringify({ error: "Database error", details: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Evento guardado exitosamente:", data.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        event_id: data.id,
        tipo: tipoEvento 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error: unknown) {
    console.error("Error procesando webhook:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Internal server error", message: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
