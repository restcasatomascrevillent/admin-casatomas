import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    
    if (!query || typeof query !== 'string') {
      return new Response(
        JSON.stringify({ error: "Se requiere un término de búsqueda" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    if (!PERPLEXITY_API_KEY) {
      console.error("PERPLEXITY_API_KEY no configurada");
      return new Response(
        JSON.stringify({ error: "API key no configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `Eres un asistente especializado en precios de productos alimentarios para restaurantes en España. 
Tu objetivo es proporcionar información actualizada sobre precios en lonjas de pescado, mercados mayoristas (Mercamadrid, Mercabarna, etc.), 
y proveedores de hostelería.

Cuando busques precios:
- Indica siempre la fuente y fecha si está disponible
- Proporciona rangos de precios cuando sea posible
- Menciona la unidad (€/kg, €/unidad, etc.)
- Incluye variaciones por calidad o origen si aplica
- Si no encuentras datos actuales, indica que los precios pueden variar

Responde siempre en español de forma concisa y estructurada.`;

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Busca precios actuales de: ${query}. Incluye información de lonjas de pescado, mercados mayoristas españoles (Mercamadrid, Mercabarna) y proveedores de hostelería.` }
        ],
        search_recency_filter: "week",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error de Perplexity:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Límite de solicitudes excedido. Intenta de nuevo en unos minutos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Error al buscar precios" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "No se encontraron resultados";
    const citations = data.citations || [];

    return new Response(
      JSON.stringify({ 
        content,
        citations,
        query,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error en buscar-precios-mercado:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
