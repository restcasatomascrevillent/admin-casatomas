import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// URL del webhook donde se enviarán las facturas
const WEBHOOK_URL = 'https://n8npersonal.miguelbenito.space/webhook-test/d96678f4-7da1-42bd-9499-a1142767a833';


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

    // Crear FormData para enviar el archivo
    const formData = new FormData();
    
    // Convertir base64 a Blob y añadir al FormData
    if (payload.archivo?.contenido_base64) {
      const binaryString = atob(payload.archivo.contenido_base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes.buffer], { type: payload.archivo.tipo });
      formData.append('file', blob, payload.archivo.nombre);
    }
    
    // Añadir metadatos adicionales
    formData.append('tipo', payload.tipo || 'factura');
    formData.append('fecha', payload.fecha || new Date().toISOString());
    formData.append('nombre_archivo', payload.archivo?.nombre || 'archivo');
    formData.append('tipo_archivo', payload.archivo?.tipo || 'application/octet-stream');
    formData.append('size', String(payload.archivo?.size || 0));

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
