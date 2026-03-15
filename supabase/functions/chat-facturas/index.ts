import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const WEBHOOK_CHAT_URL = 'https://n8npersonal.miguelbenito.space/webhook/chatbot';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { mensaje, session_id } = await req.json();

    console.log('Chat facturas - Mensaje:', mensaje, '- Session:', session_id);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(WEBHOOK_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensaje,
        session_id,
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log('Respuesta del webhook chat:', response.status);

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          success: true,
          respuesta: 'El servicio de IA no está disponible en este momento. Inténtalo de nuevo en unos minutos.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    let webhookData = null;
    const rawText = await response.text();

    try {
      webhookData = JSON.parse(rawText);
    } catch {
      // Si no es JSON, usar el texto directamente
      webhookData = { text: rawText };
    }

    // Extraer respuesta - el webhook devuelve un array: [{output: "..."}]
    const firstItem = Array.isArray(webhookData) ? webhookData[0] : webhookData;

    const respuesta = firstItem?.output ||
      firstItem?.text ||
      firstItem?.message ||
      firstItem?.response ||
      firstItem?.respuesta ||
      firstItem?.answer ||
      firstItem?.result ||
      (typeof firstItem === 'string' ? firstItem : null) ||
      (typeof rawText === 'string' && rawText.length > 0 && !rawText.startsWith('[') && !rawText.startsWith('{') ? rawText : null) ||
      'No pude obtener una respuesta. Por favor, intenta de nuevo.';

    return new Response(
      JSON.stringify({ success: true, respuesta }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: unknown) {
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
