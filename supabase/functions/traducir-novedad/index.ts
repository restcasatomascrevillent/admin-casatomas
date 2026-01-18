import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { titulo, descripcion, badge_text, bullets, tags } = await req.json();

    console.log("Recibido para traducir:", { titulo, descripcion, badge_text, bullets, tags });

    // Validar que al menos haya título
    if (!titulo) {
      return new Response(
        JSON.stringify({ error: "El título es obligatorio para traducir" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Preparar el payload para el webhook de n8n
    const webhookPayload = {
      titulo,
      descripcion: descripcion || "",
      badge_text: badge_text || "",
      bullets: bullets || [],
      tags: tags || [],
      idiomas_destino: ["en", "fr"]
    };

    // URL del webhook de n8n para traducciones
    const N8N_WEBHOOK_URL = Deno.env.get("N8N_TRADUCIR_NOVEDAD_WEBHOOK");
    
    if (!N8N_WEBHOOK_URL) {
      console.log("N8N_TRADUCIR_NOVEDAD_WEBHOOK no configurado, usando traducciones simuladas");
      
      // Traducciones simuladas para desarrollo/testing
      const traducciones = {
        titulo_en: titulo ? `${titulo} (EN)` : null,
        titulo_fr: titulo ? `${titulo} (FR)` : null,
        descripcion_en: descripcion ? `${descripcion} (EN)` : null,
        descripcion_fr: descripcion ? `${descripcion} (FR)` : null,
        badge_text_en: badge_text ? translateBadge(badge_text, "en") : null,
        badge_text_fr: badge_text ? translateBadge(badge_text, "fr") : null,
        bullets_en: bullets?.length ? bullets.map((b: string) => `${b} (EN)`) : null,
        bullets_fr: bullets?.length ? bullets.map((b: string) => `${b} (FR)`) : null,
        tags_en: tags?.length ? tags.map((t: string) => translateTag(t, "en")) : null,
        tags_fr: tags?.length ? tags.map((t: string) => translateTag(t, "fr")) : null,
      };

      return new Response(
        JSON.stringify(traducciones),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Llamar al webhook de n8n
    console.log("Llamando webhook n8n:", N8N_WEBHOOK_URL);
    const webhookResponse = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error("Error del webhook:", webhookResponse.status, errorText);
      throw new Error(`Webhook error: ${webhookResponse.status}`);
    }

    const traducciones = await webhookResponse.json();
    console.log("Traducciones recibidas:", traducciones);

    return new Response(
      JSON.stringify(traducciones),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Error al procesar la traducción";
    console.error("Error en traducir-novedad:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Funciones auxiliares para traducciones básicas de prueba
function translateBadge(text: string, lang: "en" | "fr"): string {
  const badgeTranslations: Record<string, Record<string, string>> = {
    "Nuevo": { en: "New", fr: "Nouveau" },
    "Oferta": { en: "Offer", fr: "Offre" },
    "Popular": { en: "Popular", fr: "Populaire" },
    "Destacado": { en: "Featured", fr: "En vedette" },
    "Especial": { en: "Special", fr: "Spécial" },
    "Limitado": { en: "Limited", fr: "Limité" },
    "Exclusivo": { en: "Exclusive", fr: "Exclusif" },
  };
  return badgeTranslations[text]?.[lang] || text;
}

function translateTag(text: string, lang: "en" | "fr"): string {
  const tagTranslations: Record<string, Record<string, string>> = {
    "Menú": { en: "Menu", fr: "Menu" },
    "Primavera": { en: "Spring", fr: "Printemps" },
    "Verano": { en: "Summer", fr: "Été" },
    "Otoño": { en: "Autumn", fr: "Automne" },
    "Invierno": { en: "Winter", fr: "Hiver" },
    "Temporada": { en: "Season", fr: "Saison" },
    "Promoción": { en: "Promotion", fr: "Promotion" },
    "Evento": { en: "Event", fr: "Événement" },
  };
  return tagTranslations[text]?.[lang] || text;
}
