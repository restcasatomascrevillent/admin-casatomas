import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// URL del webhook donde se enviarán las facturas
const WEBHOOK_URL = 'https://n8npersonal.miguelbenito.space/webhook/facturas';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();

    console.log('Recibida factura para procesar:', {
      tipo: payload.tipo,
      archivo_nombre: payload.archivo?.nombre,
      archivo_tipo: payload.archivo?.tipo,
      archivo_size: payload.archivo?.size,
      fecha: payload.fecha,
    });

    // Enviar al webhook
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos timeout

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log('Respuesta del webhook:', response.status);

    let webhookResponse = null;
    try {
      webhookResponse = await response.json();
    } catch {
      webhookResponse = await response.text();
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Factura enviada correctamente',
        status: response.status,
        webhookResponse,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error procesando factura:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
