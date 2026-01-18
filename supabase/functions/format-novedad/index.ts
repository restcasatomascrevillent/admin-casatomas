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

    const buildFallback = (message: string, extra?: Record<string, unknown>) => {
      return {
        title: null,
        subtitle: null,
        body: texto,
        bullets: [],
        cta: null,
        tags: [],
        meta: {
          // EditorNovedadesWeb ya sabe mostrar warnings si meta.missing tiene contenido
          missing: [message],
          source: 'fallback',
          ...(extra || {})
        }
      };
    };

    console.log('Enviando al webhook:', { tipo, idioma, tono, texto, negocio, canal });

    // Llamada al webhook de n8n con timeout de 30 segundos
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let webhookResponse: Response;
    try {
      webhookResponse = await fetch(WEBHOOK_URL, {
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
    } finally {
      clearTimeout(timeout);
    }

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error('Error del webhook:', webhookResponse.status, errorText);

      // Evitamos romper el editor si el workflow de n8n está desactivado/no existe.
      // Devolvemos un fallback con warning para que el usuario pueda seguir.
      return new Response(
        JSON.stringify(buildFallback(`Webhook no disponible (${webhookResponse.status}). Se ha usado el texto original.`, {
          webhook_status: webhookResponse.status,
        })),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    // En cualquier error inesperado, devolvemos fallback (no 500) para no tumbar la UI.
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Timeout: el webhook tardó demasiado en responder. Se ha usado el texto original.'
      : (error instanceof Error ? error.message : 'Error desconocido');

    return new Response(
      JSON.stringify({
        title: null,
        subtitle: null,
        body: 'Error al generar. ' + message,
        bullets: [],
        cta: null,
        tags: [],
        meta: { missing: [message], source: 'fallback' }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
