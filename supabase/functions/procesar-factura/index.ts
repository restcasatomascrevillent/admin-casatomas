import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// URL del webhook donde se enviarán las facturas
const WEBHOOK_URL = 'https://n8npersonal.miguelbenito.space/webhook/d96678f4-7da1-42bd-9499-a1142767a833';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();

    // Validar que viene un archivo
    if (!payload.archivo?.contenido_base64) {
      throw new Error('No se recibió ningún archivo');
    }

    console.log(`[procesar-factura] ${payload.archivo.nombre} (${payload.archivo.tipo})`);

    // Crear FormData para enviar el archivo
    const formData = new FormData();
    formData.append('tipo', payload.tipo || 'AUTO');
    formData.append('fecha', payload.fecha || new Date().toISOString());

    // Convertir base64 a blob
    const binaryString = atob(payload.archivo.contenido_base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes.buffer], { type: payload.archivo.tipo });
    formData.append('file', blob, payload.archivo.nombre);

    // Enviar al webhook como multipart/form-data
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      body: formData,
    });

    // Verificar que el webhook respondió correctamente
    if (!response.ok) {
      console.error(`[procesar-factura] Webhook error: ${response.status}`);
      return new Response(
        JSON.stringify({
          success: false,
          nombre: payload.archivo.nombre,
          error: `El servicio de procesamiento no está disponible (${response.status}). Inténtalo de nuevo en unos minutos.`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200, // 200 para que el frontend pueda leer el error
        }
      );
    }

    let webhookResponse = null;
    let tipoDocumento = null;

    const responseText = await response.text();
    try {
      webhookResponse = JSON.parse(responseText);
      tipoDocumento = webhookResponse?.tipo || null;
    } catch {
      webhookResponse = responseText;
    }

    return new Response(
      JSON.stringify({
        success: true,
        nombre: payload.archivo.nombre,
        message: 'Documento procesado correctamente',
        status: response.status,
        tipo: tipoDocumento,
        webhookResponse,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error procesando documento:', error);

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
