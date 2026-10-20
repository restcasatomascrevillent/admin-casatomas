import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(conAuditoriaDePeticion("traducir-novedad-auto", createClientBase, async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tipo, id, titulo, badge_text, descripcion, bullets, tags } = await req.json();

    console.log("Recibido para traducir novedad:", { tipo, id, titulo, badge_text, descripcion, bullets, tags });

    // Validar que tengamos el ID
    if (!id) {
      return new Response(
        JSON.stringify({ error: "El ID de la novedad es obligatorio" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Preparar el payload para el webhook
    const webhookPayload = {
      tipo: tipo || "novedad",
      id,
      titulo: titulo || "",
      badge_text: badge_text || "",
      descripcion: descripcion || "",
      bullets: bullets || [],
      tags: tags || [],
    };

    // URL del webhook
    const WEBHOOK_URL = "https://n8npersonal.miguelbenito.space/webhook/traducciones";
    
    console.log("Enviando a webhook:", WEBHOOK_URL);
    console.log("Payload:", JSON.stringify(webhookPayload));

    const webhookResponse = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error("Error del webhook:", webhookResponse.status, errorText);
      throw new Error(`Webhook error: ${webhookResponse.status} - ${errorText}`);
    }

    const webhookData = await webhookResponse.json();
    console.log("Respuesta del webhook:", webhookData);

    return new Response(
      JSON.stringify({ success: true, data: webhookData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Error al procesar la traducción de novedad";
    console.error("Error en traducir-novedad-auto:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
