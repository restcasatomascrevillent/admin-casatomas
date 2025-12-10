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

    console.log('Recibida petición para procesar:', {
      tipo: payload.tipo,
      num_archivos: payload.archivos?.length || 1,
      fecha: payload.fecha,
    });

    // Crear FormData para enviar los archivos
    const formData = new FormData();
    
    // Añadir metadatos generales
    formData.append('tipo', payload.tipo || 'facturas');
    formData.append('fecha', payload.fecha || new Date().toISOString());

    // Procesar múltiples archivos (nuevo formato)
    if (payload.archivos && Array.isArray(payload.archivos)) {
      formData.append('num_archivos', String(payload.archivos.length));
      
      for (let i = 0; i < payload.archivos.length; i++) {
        const archivo = payload.archivos[i];
        
        if (archivo.contenido_base64) {
          const binaryString = atob(archivo.contenido_base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            bytes[j] = binaryString.charCodeAt(j);
          }
          const blob = new Blob([bytes.buffer], { type: archivo.tipo });
          formData.append('file', blob, archivo.nombre);
        }
        
        console.log(`Archivo ${i + 1}:`, {
          nombre: archivo.nombre,
          tipo: archivo.tipo,
          size: archivo.size,
        });
      }
    } 
    // Compatibilidad con formato antiguo (un solo archivo)
    else if (payload.archivo?.contenido_base64) {
      formData.append('num_archivos', '1');
      
      const binaryString = atob(payload.archivo.contenido_base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes.buffer], { type: payload.archivo.tipo });
      formData.append('file', blob, payload.archivo.nombre);
      
      console.log('Archivo único:', {
        nombre: payload.archivo.nombre,
        tipo: payload.archivo.tipo,
        size: payload.archivo.size,
      });
    }

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
        message: 'Facturas enviadas correctamente',
        status: response.status,
        webhookResponse,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error procesando facturas:', error);
    
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
