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

    console.log('Procesando archivo:', {
      nombre: payload.archivo.nombre,
      tipo: payload.archivo.tipo,
      size: payload.archivo.size,
      fecha: payload.fecha,
    });

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log('Respuesta del webhook:', response.status);

    let webhookResponse = null;
    let tipoDocumento = null;

    try {
      webhookResponse = await response.json();
      // Extraer el tipo de documento de la respuesta
      tipoDocumento = webhookResponse?.tipo || null;
    } catch {
      webhookResponse = await response.text();
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
