import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WEBHOOK_URL = "https://n8npersonal.miguelbenito.space/webhook/format-novedad";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tipo, idioma, tono, texto, negocio, canal } = await req.json();

    if (!texto || texto.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'El campo texto es obligatorio' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Enviando al webhook:', { tipo, idioma, tono, texto, negocio, canal });

    // Llamada al webhook de n8n con timeout de 30 segundos
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const webhookResponse = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tipo: tipo || 'anuncio',
        idioma: idioma || 'es',
        tono: tono || 'cercano',
        texto: texto,
        negocio: negocio || null,
        canal: canal || 'novedades'
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error('Error del webhook:', webhookResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: `Error del webhook: ${webhookResponse.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await webhookResponse.json();
    console.log('Respuesta del webhook:', data);

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error en format-novedad:', error);
    
    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(
        JSON.stringify({ error: 'Timeout: el webhook tardó demasiado en responder' }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Error desconocido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
