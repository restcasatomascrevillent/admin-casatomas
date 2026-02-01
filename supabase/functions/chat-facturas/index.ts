import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// URL del webhook de chat de n8n - PLACEHOLDER para configurar
const WEBHOOK_CHAT_URL = 'https://n8npersonal.miguelbenito.space/webhook/chatbot';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { mensaje, historial } = await req.json();

    console.log('Chat facturas - Mensaje recibido:', mensaje);
    console.log('Chat facturas - Historial:', historial?.length || 0, 'mensajes');

    // Enviar al webhook de n8n
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(WEBHOOK_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensaje,
        historial,
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log('Respuesta del webhook chat:', response.status);

    let webhookData = null;
    try {
      webhookData = await response.json();
    } catch {
      const textResponse = await response.text();
      webhookData = { text: textResponse };
    }

    // Extraer la respuesta del formato del webhook
    const respuesta = webhookData?.output?.[0]?.content?.[0]?.text ||
      webhookData?.text ||
      webhookData?.message ||
      webhookData?.response ||
      webhookData?.respuesta ||
      (typeof webhookData === 'string' ? webhookData : null) ||
      'No pude obtener una respuesta. Por favor, intenta de nuevo.';

    return new Response(
      JSON.stringify({
        success: true,
        respuesta,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error en chat-facturas:', error);

    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';

    return new Response(
      JSON.stringify({
        success: false,
        respuesta: 'Lo siento, hubo un error al procesar tu consulta.',
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
