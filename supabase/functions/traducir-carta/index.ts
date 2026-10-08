import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WEBHOOK_URL = "https://n8npersonal.miguelbenito.space/webhook/5eca0d6c-7077-45bc-959c-2d597180eefa";

serve(conAuditoriaDePeticion("traducir-carta", createClientBase, async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = await req.json();
    const { 
      nombre, 
      descripcion, 
      ingredientes,
      categoria, 
      tipo,
      // Platos
      alergenos,
      // Bebidas
      tamano,
      // Vinos
      ubicacion_pais,
      ubicacion_region,
      alergenos_notas,
    } = requestBody;

    console.log('Received translation request:', requestBody);

    if (!nombre) {
      return new Response(
        JSON.stringify({ error: 'El campo nombre es obligatorio' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build payload with all translatable fields
    const webhookPayload: Record<string, unknown> = {
      nombre: nombre || '',
      descripcion: descripcion || '',
      ingredientes: ingredientes || '',
      categoria: categoria || '',
      tipo: tipo || 'plato',
    };

    // Add type-specific fields
    if (alergenos !== undefined) webhookPayload.alergenos = alergenos;
    if (tamano !== undefined) webhookPayload.tamano = tamano;
    if (ubicacion_pais !== undefined) webhookPayload.ubicacion_pais = ubicacion_pais;
    if (ubicacion_region !== undefined) webhookPayload.ubicacion_region = ubicacion_region;
    if (alergenos_notas !== undefined) webhookPayload.alergenos_notas = alergenos_notas;

    // Send to n8n webhook
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    console.log('Sending to webhook:', webhookPayload);

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Webhook error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: `Error del webhook: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const webhookResponse = await response.json();
    console.log('Webhook response:', webhookResponse);

    return new Response(
      JSON.stringify(webhookResponse),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in traducir-carta function:', error);
    
    const err = error as Error;
    if (err.name === 'AbortError') {
      return new Response(
        JSON.stringify({ error: 'Timeout: el webhook tardó demasiado en responder' }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: err.message || 'Error desconocido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}));
