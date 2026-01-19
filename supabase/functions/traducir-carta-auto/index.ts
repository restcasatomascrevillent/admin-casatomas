import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WEBHOOK_URL = "https://n8npersonal.miguelbenito.space/webhook-test/traducciones";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log("Received payload:", JSON.stringify(payload));

    const { tipo, nombre, descripcion, categoria, alergenos, tamano, ubicacion_pais, ubicacion_region, alergenos_notas, precio, unidad } = payload;

    if (!nombre) {
      return new Response(
        JSON.stringify({ error: "El campo 'nombre' es obligatorio" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the webhook payload based on type
    let webhookPayload: Record<string, unknown> = {
      nombre,
      descripcion: descripcion || "",
      categoria: categoria || "",
      tipo,
    };

    if (tipo === "plato") {
      webhookPayload.alergenos = alergenos || [];
      webhookPayload.precio = precio;
      webhookPayload.unidad = unidad || "";
    } else if (tipo === "bebida") {
      webhookPayload.tamano = tamano || "";
      webhookPayload.precio = precio;
    } else if (tipo === "vino") {
      webhookPayload.ubicacion_pais = ubicacion_pais || "";
      webhookPayload.ubicacion_region = ubicacion_region || "";
      webhookPayload.alergenos_notas = alergenos_notas || "";
    }

    console.log("Sending to webhook:", JSON.stringify(webhookPayload));

    // Call the translation webhook with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Webhook error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Error del webhook de traducción", details: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    console.log("Webhook response:", JSON.stringify(result));

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in traducir-carta-auto:", error);
    
    const err = error as Error;
    if (err.name === "AbortError") {
      return new Response(
        JSON.stringify({ error: "Timeout: el webhook de traducción no respondió a tiempo" }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: err.message || "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
