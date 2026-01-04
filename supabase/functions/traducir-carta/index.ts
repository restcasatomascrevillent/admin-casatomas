import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WEBHOOK_URL = "https://n8npersonal.miguelbenito.space/webhook-test/5eca0d6c-7077-45bc-959c-2d597180eefa";

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { nombre, descripcion, categoria, tipo } = await req.json();

    console.log('Received translation request:', { nombre, descripcion, categoria, tipo });

    if (!nombre) {
      return new Response(
        JSON.stringify({ error: 'El campo nombre es obligatorio' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send to n8n webhook
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nombre: nombre || '',
        descripcion: descripcion || '',
        categoria: categoria || '',
        tipo: tipo || 'plato',
      }),
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
});
