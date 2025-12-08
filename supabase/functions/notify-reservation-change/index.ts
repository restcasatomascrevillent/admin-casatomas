import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WEBHOOK_URL = 'https://n8npersonal.miguelbenito.space/webhook/79fc330e-1683-477e-815e-d4542b54d596';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { oldData, newData } = await req.json();
    
    console.log('Notifying webhook about reservation change:', {
      reservationId: newData?.id,
      oldStatus: oldData?.estado,
      newStatus: newData?.estado
    });

    // Solo enviar si hay cambio de estado
    if (oldData?.estado === newData?.estado) {
      console.log('No status change detected, skipping webhook');
      return new Response(
        JSON.stringify({ success: true, message: 'No status change' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Enviar al webhook con timeout de 5 segundos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old: oldData, new: newData }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      
      console.log('Webhook response status:', response.status);
      
      return new Response(
        JSON.stringify({ success: true, status: response.status }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (fetchError: unknown) {
      clearTimeout(timeoutId);
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
      console.error('Webhook call failed:', errorMessage);
      
      // No bloqueamos - devolvemos success aunque falle el webhook
      return new Response(
        JSON.stringify({ success: true, webhookError: errorMessage }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in notify-reservation-change:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});