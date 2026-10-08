import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(conAuditoriaDePeticion("enviar-imagen-webhook", createClientBase, async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tipo, item_id, item_nombre, archivo_nombre, archivo_tipo, archivo_size, archivo_base64 } = await req.json();

    console.log('Recibido request para enviar imagen:', {
      tipo,
      item_id,
      item_nombre,
      archivo_nombre,
      archivo_tipo,
      archivo_size,
      archivo_base64_length: archivo_base64?.length || 0,
    });

    // Preparar los datos para el webhook
    const webhookData = {
      tipo,
      item_id,
      item_nombre,
      archivo: {
        nombre: archivo_nombre,
        tipo: archivo_tipo,
        size: archivo_size,
        contenido_base64: archivo_base64,
      },
      fecha: new Date().toISOString(),
    };

    // Enviar al webhook de n8n
    const webhookUrl = 'https://oficiososia.app.n8n.cloud/webhook-test/35ff4989-493b-4836-811a-051a64dcfcab';
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookData),
    });

    if (!response.ok) {
      throw new Error(`Webhook respondió con estado ${response.status}`);
    }

    const responseData = await response.json();
    console.log('Respuesta del webhook:', responseData);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Imagen enviada correctamente al webhook',
        webhookResponse: responseData,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error en enviar-imagen-webhook:', error);
    
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
}));
